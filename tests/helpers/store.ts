import { Address, BigDecimal, BigInt } from "@graphprotocol/graph-ts";
import {
  Broadcaster,
  Delegator,
  Poll,
  Protocol,
  Transcoder,
  UnbondingLock,
  Vote,
} from "../../src/types/schema";
import {
  createOrLoadBroadcaster,
  createOrLoadDelegator,
  createOrLoadTranscoder,
  makeUnbondingLockId,
  makeVoteId,
} from "../../utils/helpers";
import {
  LAST_ROUND_LENGTH_UPDATE_ROUND,
  LAST_ROUND_LENGTH_UPDATE_START_BLOCK,
  ROUND_LENGTH,
  TIMESTAMP,
} from "./constants";

export function decimal(value: string): BigDecimal {
  return BigDecimal.fromString(value);
}

// Saves the Protocol singleton with the round fixture from constants.ts, so
// createOrLoadProtocol() takes its load-hit path and makes no eth_call.
export function seedProtocol(): Protocol {
  let protocol = new Protocol("0");
  protocol.paused = false;
  protocol.currentRound = LAST_ROUND_LENGTH_UPDATE_ROUND;
  protocol.lastInitializedRound = LAST_ROUND_LENGTH_UPDATE_ROUND;
  protocol.lastRoundLengthUpdateRound = LAST_ROUND_LENGTH_UPDATE_ROUND;
  protocol.lastRoundLengthUpdateStartBlock = LAST_ROUND_LENGTH_UPDATE_START_BLOCK;
  protocol.roundLength = ROUND_LENGTH;
  protocol.inflation = BigInt.zero();
  protocol.inflationChange = BigInt.zero();
  protocol.lockPeriod = BigInt.zero();
  protocol.roundLockAmount = BigInt.zero();
  protocol.targetBondingRate = BigInt.zero();
  protocol.totalActiveStake = BigDecimal.zero();
  protocol.totalSupply = BigDecimal.zero();
  protocol.participationRate = BigDecimal.zero();
  protocol.totalVolumeETH = BigDecimal.zero();
  protocol.totalVolumeUSD = BigDecimal.zero();
  protocol.unbondingPeriod = BigInt.zero();
  protocol.numActiveTranscoders = BigInt.zero();
  protocol.activeTranscoderCount = BigInt.zero();
  protocol.winningTicketCount = 0;
  protocol.roundCount = 0;
  protocol.lptPriceEth = BigDecimal.zero();
  protocol.activeBroadcasters = [];
  protocol.delegatorsCount = BigInt.zero();
  protocol.pendingActivation = [];
  protocol.pendingDeactivation = [];
  protocol.save();
  return protocol;
}

export function seedTranscoder(
  address: Address,
  status: string,
  totalStake: string
): Transcoder {
  let transcoder = createOrLoadTranscoder(address.toHex(), TIMESTAMP);
  transcoder.status = status;
  transcoder.totalStake = decimal(totalStake);
  transcoder.save();
  return transcoder;
}

export function seedDelegator(
  address: Address,
  delegate: Address,
  bondedAmount: string
): Delegator {
  let delegator = createOrLoadDelegator(address.toHex(), TIMESTAMP);
  delegator.delegate = delegate.toHex();
  delegator.bondedAmount = decimal(bondedAmount);
  delegator.principal = decimal(bondedAmount);
  delegator.save();
  return delegator;
}

export function seedUnbondedDelegator(address: Address, unbonded: string): Delegator {
  let delegator = createOrLoadDelegator(address.toHex(), TIMESTAMP);
  delegator.delegate = null;
  delegator.unbonded = decimal(unbonded);
  delegator.save();
  return delegator;
}

export function seedUnbondingLock(
  delegator: Address,
  lockId: i32,
  sender: Address,
  delegate: Address,
  amount: string,
  withdrawRound: i32
): UnbondingLock {
  let lock = new UnbondingLock(
    makeUnbondingLockId(delegator, BigInt.fromI32(lockId))
  );
  lock.unbondingLockId = lockId;
  lock.delegator = delegator.toHex();
  lock.sender = sender.toHex();
  lock.delegate = delegate.toHex();
  lock.amount = decimal(amount);
  lock.withdrawRound = BigInt.fromI32(withdrawRound);
  lock.save();
  return lock;
}

export function seedBroadcaster(
  address: Address,
  deposit: string,
  reserve: string
): Broadcaster {
  let broadcaster = createOrLoadBroadcaster(address.toHex());
  broadcaster.deposit = decimal(deposit);
  broadcaster.reserve = decimal(reserve);
  broadcaster.save();
  return broadcaster;
}

export function seedPoll(address: Address, endBlock: BigInt): Poll {
  let poll = new Poll(address.toHex());
  poll.proposal = "proposal";
  poll.endBlock = endBlock;
  poll.quorum = BigInt.fromI32(333300);
  poll.quota = BigInt.fromI32(500000);
  poll.votes = [];
  poll.save();
  return poll;
}

// Saves a Vote that has been cast (choiceID set) and lists it on the poll, as
// the Poll template's vote() handler does for a first-time voter.
export function seedCastVote(
  voter: Address,
  poll: Address,
  choiceID: string,
  voteStake: string,
  nonVoteStake: string,
  registeredTranscoder: boolean
): Vote {
  let vote = seedUncastVote(voter, poll, voteStake, nonVoteStake, registeredTranscoder);
  vote.choiceID = choiceID;
  vote.poll = poll.toHex();
  vote.save();

  let storedPoll = Poll.load(poll.toHex())!;
  let votes = storedPoll.votes;
  votes.push(vote.id);
  storedPoll.votes = votes;
  storedPoll.save();
  return vote;
}

// Saves a placeholder Vote that tracks nonVoteStake for a delegate who has not
// voted. It is not listed on the poll, so tallyVotes() ignores it.
export function seedUncastVote(
  voter: Address,
  poll: Address,
  voteStake: string,
  nonVoteStake: string,
  registeredTranscoder: boolean
): Vote {
  let vote = new Vote(makeVoteId(voter.toHex(), poll.toHex()));
  vote.voter = voter.toHex();
  vote.voteStake = decimal(voteStake);
  vote.nonVoteStake = decimal(nonVoteStake);
  vote.registeredTranscoder = registeredTranscoder;
  vote.save();
  return vote;
}

export function voteId(voter: Address, poll: Address): string {
  return makeVoteId(voter.toHex(), poll.toHex());
}

export function unbondingLockId(delegator: Address, lockId: i32): string {
  return makeUnbondingLockId(delegator, BigInt.fromI32(lockId));
}
