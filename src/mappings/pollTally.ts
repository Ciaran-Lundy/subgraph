import { Address, BigDecimal, BigInt, log } from "@graphprotocol/graph-ts";
import {
  convertToDecimal,
  createOrLoadVote,
  EMPTY_ADDRESS,
  makeVoteId,
  pollIdFromVoteId,
  ZERO_BD,
} from "../../utils/helpers";
import { BONDING_MANAGER_ADDRESS } from "../../utils/addresses";
import { BondingManager } from "../types/BondingManager/BondingManager";
import {
  Delegator,
  LivepeerAccount,
  Poll,
  PollTally,
  Protocol,
  Transcoder,
  Vote,
} from "../types/schema";

// Keeps poll vote stakes current as bonding state changes. This replaces the
// PollTallyTemplate data source, which ran one handler per (poll, voter) on
// every BondingManager event and was never removed. Here the bonding handlers
// call in directly and only load the votes of the accounts the event names:
// - bond/unbond/rebond: the delegator's own votes and its delegates' votes
// - reward: the transcoder's own votes and its delegators' votes, through
//   Vote.delegate (Transcoder.delegatorVotes)
//
// Poll end blocks and the block passed in here are L1 block numbers
// (RoundsManager.blockNum()), since Poll contracts use block.number on L1.

// Votes touched while handling one event. Every Vote is held as a single
// in-memory instance, so a vote reached through two paths (e.g. a transcoder
// that is both the old delegate and the voter) cannot be saved twice with
// conflicting values.
class VoteBatch {
  blockNum: BigInt;
  votes: Map<string, Vote> = new Map();
  pollOpen: Map<string, boolean> = new Map();
  touchedPolls: Array<string> = [];

  constructor(blockNum: BigInt) {
    this.blockNum = blockNum;
  }

  isOpen(pollId: string): boolean {
    if (this.pollOpen.has(pollId)) {
      return this.pollOpen.get(pollId);
    }
    let poll = Poll.load(pollId);
    let open = poll != null && poll.endBlock.ge(this.blockNum);
    this.pollOpen.set(pollId, open);
    return open;
  }

  // The cached instance of `vote`, or `vote` itself if it is new to the batch
  track(vote: Vote): Vote {
    if (this.votes.has(vote.id)) {
      return this.votes.get(vote.id);
    }
    this.votes.set(vote.id, vote);
    let pollId = pollIdFromVoteId(vote.id);
    if (!this.touchedPolls.includes(pollId)) {
      this.touchedPolls.push(pollId);
    }
    return vote;
  }

  // The voter's vote on the poll, creating a placeholder if it has none
  getOrCreate(voter: string, pollId: string): Vote {
    let id = makeVoteId(voter, pollId);
    if (this.votes.has(id)) {
      return this.votes.get(id);
    }
    return this.track(createOrLoadVote(voter, pollId));
  }

  // The voter's vote on the poll, if one exists
  get(voter: string, pollId: string): Vote | null {
    let id = makeVoteId(voter, pollId);
    if (this.votes.has(id)) {
      return this.votes.get(id);
    }
    let vote = Vote.load(id);
    if (vote == null) {
      return null;
    }
    return this.track(vote);
  }

  // Votes (including placeholders) on open polls for an account
  openVotesOf(address: string): Array<Vote> {
    let result = new Array<Vote>();
    if (address == EMPTY_ADDRESS.toHex()) {
      return result;
    }
    let account = LivepeerAccount.load(address);
    if (account == null) {
      return result;
    }
    return this.openOnly(account.votes.load());
  }

  // Votes on open polls cast by the transcoder's current delegators
  openDelegatorVotesOf(transcoder: Transcoder): Array<Vote> {
    return this.openOnly(transcoder.delegatorVotes.load());
  }

  openOnly(votes: Array<Vote>): Array<Vote> {
    let result = new Array<Vote>();
    for (let i = 0; i < votes.length; i++) {
      if (this.isOpen(pollIdFromVoteId(votes[i].id))) {
        result.push(this.track(votes[i]));
      }
    }
    return result;
  }

  commit(): void {
    let votes = this.votes.values();
    for (let i = 0; i < votes.length; i++) {
      votes[i].save();
    }
    for (let i = 0; i < this.touchedPolls.length; i++) {
      let poll = Poll.load(this.touchedPolls[i]);
      if (poll) {
        tallyVotes(poll);
      }
    }
  }
}

function hasCastVote(vote: Vote): boolean {
  return vote.choiceID != null;
}

function isRegistered(transcoder: Transcoder | null): boolean {
  return transcoder != null && transcoder.status == "Registered";
}

function pendingStake(delegator: string, roundId: string): BigDecimal {
  let bondingManager = BondingManager.bind(
    Address.fromString(BONDING_MANAGER_ADDRESS)
  );
  let result = bondingManager.try_pendingStake(
    Address.fromString(delegator),
    BigInt.fromString(roundId)
  );
  if (result.reverted) {
    log.warning("pendingStake reverted for {} in round {}", [
      delegator,
      roundId,
    ]);
    return ZERO_BD;
  }
  return convertToDecimal(result.value);
}

// Cheap guard so that bonding events do no vote work while no poll is open
function anyPollOpen(protocol: Protocol, blockNum: BigInt): boolean {
  return protocol.latestPollEndBlock.ge(blockNum);
}

// Called by the Bond handler after it has saved the transcoders
export function updateVotesOnBond(
  protocol: Protocol,
  blockNum: BigInt,
  delegatorAddress: string,
  oldDelegateAddress: string,
  newDelegateAddress: string,
  bondedAmountRaw: BigInt,
  additionalAmountRaw: BigInt
): void {
  if (!anyPollOpen(protocol, blockNum)) {
    return;
  }
  let batch = new VoteBatch(blockNum);
  let bondedAmount = convertToDecimal(bondedAmountRaw);
  let previousBondedAmount = convertToDecimal(
    bondedAmountRaw.minus(additionalAmountRaw)
  );
  let isSwitchingDelegates =
    previousBondedAmount.gt(ZERO_BD) &&
    oldDelegateAddress != newDelegateAddress;
  let oldDelegate = Transcoder.load(oldDelegateAddress);
  let newDelegate = Transcoder.load(newDelegateAddress);

  // The old delegate lost this stake: refresh its own votes
  if (oldDelegateAddress != newDelegateAddress) {
    let oldDelegateVotes = batch.openVotesOf(oldDelegateAddress);
    for (let i = 0; i < oldDelegateVotes.length; i++) {
      let vote = oldDelegateVotes[i];
      vote.registeredTranscoder = isRegistered(oldDelegate);
      if (isSwitchingDelegates && hasCastVote(vote) && oldDelegate) {
        vote.voteStake = oldDelegate.totalStake;
      }
    }
  }

  // The new delegate gained this stake: refresh its own votes
  let newDelegateVotes = batch.openVotesOf(newDelegateAddress);
  for (let i = 0; i < newDelegateVotes.length; i++) {
    let vote = newDelegateVotes[i];
    vote.registeredTranscoder = isRegistered(newDelegate);
    if (vote.registeredTranscoder && hasCastVote(vote) && newDelegate) {
      vote.voteStake = newDelegate.totalStake;
    }
  }

  // The delegator's own votes now carry its new bonded amount, which moves
  // from the old delegate's nonVoteStake to the new delegate's. A delegator
  // bonding to itself (registering) only leaves the old delegate: its own
  // vote stake was refreshed above as the new delegate's.
  let delegatorVotes = batch.openVotesOf(delegatorAddress);
  for (let i = 0; i < delegatorVotes.length; i++) {
    let vote = delegatorVotes[i];
    if (!hasCastVote(vote)) {
      continue;
    }
    let pollId = pollIdFromVoteId(vote.id);

    if (isSwitchingDelegates) {
      let oldDelegateVote = batch.get(oldDelegateAddress, pollId);
      if (oldDelegateVote) {
        oldDelegateVote.nonVoteStake =
          oldDelegateVote.nonVoteStake.minus(previousBondedAmount);
      }
    }

    if (delegatorAddress == newDelegateAddress) {
      vote.delegate = null;
      continue;
    }

    let newDelegateVote = batch.getOrCreate(newDelegateAddress, pollId);
    newDelegateVote.registeredTranscoder = isRegistered(newDelegate);
    if (isSwitchingDelegates) {
      newDelegateVote.nonVoteStake =
        newDelegateVote.nonVoteStake.plus(bondedAmount);
    } else {
      newDelegateVote.nonVoteStake = newDelegateVote.nonVoteStake
        .minus(vote.voteStake)
        .plus(bondedAmount);
    }

    vote.voteStake = bondedAmount;
    vote.delegate = newDelegateAddress;
  }

  batch.commit();
}

// Called by the Unbond and Rebond handlers after they have saved the
// delegator and transcoder
export function updateVotesOnUnbondOrRebond(
  protocol: Protocol,
  blockNum: BigInt,
  roundId: string,
  delegatorAddress: string,
  delegateAddress: string
): void {
  if (!anyPollOpen(protocol, blockNum)) {
    return;
  }
  let batch = new VoteBatch(blockNum);
  let delegate = Transcoder.load(delegateAddress);
  let registered = isRegistered(delegate);

  let delegateVotes = batch.openVotesOf(delegateAddress);
  for (let i = 0; i < delegateVotes.length; i++) {
    let vote = delegateVotes[i];
    vote.registeredTranscoder = registered;
    if (hasCastVote(vote)) {
      vote.voteStake =
        registered && delegate
          ? delegate.totalStake
          : pendingStake(delegateAddress, roundId);
    }
  }

  if (delegatorAddress != delegateAddress) {
    let delegatorVotes = batch.openVotesOf(delegatorAddress);
    let stake = ZERO_BD;
    let delegatorDelegate: string | null = null;
    if (delegatorVotes.length > 0) {
      stake = pendingStake(delegatorAddress, roundId);
      let delegator = Delegator.load(delegatorAddress);
      if (delegator) {
        delegatorDelegate = delegator.delegate;
      }
    }
    for (let i = 0; i < delegatorVotes.length; i++) {
      let vote = delegatorVotes[i];
      if (!hasCastVote(vote)) {
        continue;
      }
      let delegateVote = batch.getOrCreate(
        delegateAddress,
        pollIdFromVoteId(vote.id)
      );
      delegateVote.registeredTranscoder = registered;
      delegateVote.nonVoteStake = delegateVote.nonVoteStake
        .minus(vote.voteStake)
        .plus(stake);

      vote.voteStake = stake;
      vote.delegate = delegatorDelegate;
    }
  }

  batch.commit();
}

// Called by the Reward handler after it has saved the transcoder
export function updateVotesOnReward(
  protocol: Protocol,
  blockNum: BigInt,
  roundId: string,
  transcoder: Transcoder
): void {
  if (!anyPollOpen(protocol, blockNum)) {
    return;
  }
  let batch = new VoteBatch(blockNum);

  let transcoderVotes = batch.openVotesOf(transcoder.id);
  for (let i = 0; i < transcoderVotes.length; i++) {
    if (hasCastVote(transcoderVotes[i])) {
      transcoderVotes[i].voteStake = transcoder.totalStake;
    }
  }

  let delegatorVotes = batch.openDelegatorVotesOf(transcoder);
  for (let i = 0; i < delegatorVotes.length; i++) {
    let vote = delegatorVotes[i];
    if (!hasCastVote(vote)) {
      continue;
    }
    let stake = pendingStake(vote.voter, roundId);
    let transcoderVote = batch.getOrCreate(
      transcoder.id,
      pollIdFromVoteId(vote.id)
    );
    transcoderVote.registeredTranscoder = isRegistered(transcoder);
    transcoderVote.nonVoteStake = transcoderVote.nonVoteStake
      .minus(vote.voteStake)
      .plus(stake);
    vote.voteStake = stake;
  }

  batch.commit();
}

// Must run after the votes it should count have been saved: Poll.votes is
// derived, so it is read back from the store
export function tallyVotes(poll: Poll): void {
  let pollTally = new PollTally(poll.id);
  let votes = poll.votes.load();
  let nonVoteStake = ZERO_BD;
  pollTally.yes = ZERO_BD;
  pollTally.no = ZERO_BD;
  pollTally.totalVoteStake = ZERO_BD;
  pollTally.totalNonVoteStake = ZERO_BD;

  for (let i = 0; i < votes.length; i++) {
    let v = votes[i];

    // Only subtract nonVoteStake if delegate was registered during poll period
    nonVoteStake = v.registeredTranscoder ? v.nonVoteStake : ZERO_BD;

    if (v.choiceID == "Yes") {
      pollTally.yes = pollTally.yes.plus(v.voteStake.minus(nonVoteStake));
    }
    if (v.choiceID == "No") {
      pollTally.no = pollTally.no.plus(v.voteStake.minus(nonVoteStake));
    }
    pollTally.totalVoteStake = pollTally.totalVoteStake.plus(v.voteStake);
    pollTally.totalNonVoteStake =
      pollTally.totalNonVoteStake.plus(nonVoteStake);
  }
  pollTally.save();
}
