import { Address, log } from "@graphprotocol/graph-ts";
import {
  convertToDecimal,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  createOrLoadTranscoder,
  createOrLoadVote,
  createOrUpdateLivepeerAccount,
  getBlockNum,
  integerFromString,
  makeEventId,
  ONE_BI,
  ZERO_BI,
} from "../../utils/helpers";
import { BONDING_MANAGER_ADDRESS } from "../../utils/addresses";
import { BondingManager } from "../types/BondingManager/BondingManager";
import { Delegator, Poll, VoteEvent } from "../types/schema";
import { Vote as VoteEventParam } from "../types/templates/Poll/Poll";
import { tallyVotes } from "./pollTally";

export function vote(event: VoteEventParam): void {
  // Vote must be a "Yes" or "No"
  if (
    event.params.choiceID.notEqual(ZERO_BI) &&
    event.params.choiceID.notEqual(ONE_BI)
  ) {
    return;
  }
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let poll = Poll.load(event.address.toHex());

  if (!poll) {
    log.error("No poll found for vote", []);
    return;
  }

  let voter = event.params.voter.toHex();
  createOrUpdateLivepeerAccount(voter, event.block.timestamp.toI32());
  let v = createOrLoadVote(voter, poll.id);

  let firstTimeVoter = v.choiceID == null;

  if (event.params.choiceID.equals(ZERO_BI)) {
    v.choiceID = "Yes";
  } else {
    v.choiceID = "No";
  }

  if (firstTimeVoter) {
    v.poll = poll.id;

    // add vote to poll
    let pollVotes = poll.votes;
    pollVotes.push(v.id);
    poll.votes = pollVotes;
    poll.save();

    // if voter is a delegator
    let delegator = Delegator.load(voter);
    if (delegator && delegator.delegate !== null) {
      let delegate = createOrLoadTranscoder(
        delegator.delegate!,
        event.block.timestamp.toI32()
      );

      // If voter is a registered transcoder
      if (voter == delegator.delegate) {
        v.voteStake = delegate.totalStake;
        v.registeredTranscoder = true;
      } else {
        let bondingManager = BondingManager.bind(
          Address.fromString(BONDING_MANAGER_ADDRESS)
        );
        let pendingStake = convertToDecimal(
          bondingManager.pendingStake(
            event.params.voter,
            integerFromString(round.id)
          )
        );
        v.voteStake = pendingStake;
        v.registeredTranscoder = false;
        // Lets the delegate's Reward handler find this vote
        v.delegate = delegate.id;

        // update delegate's vote
        let delegateVote = createOrLoadVote(delegate.id, poll.id);
        delegateVote.registeredTranscoder = delegate.status == "Registered";
        delegateVote.nonVoteStake = delegateVote.nonVoteStake.plus(v.voteStake);
        delegateVote.save();
      }
    }
  }

  v.save();

  tallyVotes(poll);

  createOrLoadTransactionFromEvent(event);

  let voteEvent = new VoteEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  voteEvent.transaction = event.transaction.hash.toHex();
  voteEvent.timestamp = event.block.timestamp.toI32();
  voteEvent.round = round.id;
  voteEvent.choiceID = event.params.choiceID;
  voteEvent.voter = voter;
  voteEvent.poll = event.address.toHex();
  voteEvent.save();
}
