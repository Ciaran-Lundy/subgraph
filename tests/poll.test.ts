import { BigInt } from "@graphprotocol/graph-ts";
import {
  afterEach,
  assert,
  beforeEach,
  clearStore,
  dataSourceMock,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { tallyVotes, vote } from "../src/mappings/poll";
import { Poll } from "../src/types/schema";
import {
  ARBITRUM_ONE,
  BONDING_MANAGER,
  CURRENT_ROUND,
  DELEGATOR_A,
  eventId,
  L1_BLOCK,
  POLL,
  tokens,
  TRANSCODER_A,
  TRANSCODER_B,
  TX_HASH,
} from "./helpers/constants";
import { atLogIndex, createVoteEvent } from "./helpers/events";
import { mockBlockNum, mockBlockNumReverts, mockPendingStake } from "./helpers/mocks";
import {
  seedCastVote,
  seedDelegator,
  seedPoll,
  seedProtocol,
  seedTranscoder,
  voteId,
} from "./helpers/store";

const YES = BigInt.zero();
const NO = BigInt.fromI32(1);
const OPEN_POLL_END_BLOCK = BigInt.fromI32(2000);
const CURRENT_ROUND_NUMBER = BigInt.fromI32(12);

beforeEach(() => {
  dataSourceMock.setNetwork(ARBITRUM_ONE);
  seedProtocol();
  mockBlockNum(L1_BLOCK);
});

afterEach(() => {
  clearStore();
});

function assertTally(yes: string, no: string): void {
  assert.fieldEquals("PollTally", POLL.toHex(), "yes", yes);
  assert.fieldEquals("PollTally", POLL.toHex(), "no", no);
}

// DELEGATOR_A has no Delegator entity, so it votes with zero stake.
function firstVoteWithNoStake(): void {
  seedPoll(POLL, OPEN_POLL_END_BLOCK);
  vote(createVoteEvent(DELEGATOR_A, YES));
}

function voteAsRegisteredTranscoderA(choice: BigInt): void {
  seedTranscoder(TRANSCODER_A, "Registered", "1000");
  seedDelegator(TRANSCODER_A, TRANSCODER_A, "1000");
  vote(createVoteEvent(TRANSCODER_A, choice));
}

function voteAsDelegatorOfTranscoderA(choice: BigInt, logIndex: i32): void {
  seedDelegator(DELEGATOR_A, TRANSCODER_A, "100");
  mockPendingStake(DELEGATOR_A, CURRENT_ROUND_NUMBER, tokens(100));
  vote(atLogIndex(createVoteEvent(DELEGATOR_A, choice), logIndex));
}

describe("vote", () => {
  test("a choice other than Yes or No is ignored before any eth_call", () => {
    seedPoll(POLL, OPEN_POLL_END_BLOCK);
    mockBlockNumReverts();

    vote(createVoteEvent(DELEGATOR_A, BigInt.fromI32(2)));

    assert.notInStore("Vote", voteId(DELEGATOR_A, POLL));
    assert.entityCount("VoteEvent", 0);
    assert.dataSourceCount("PollTallyTemplate", 0);
  });

  test("a vote on a poll that is not stored records nothing", () => {
    vote(createVoteEvent(DELEGATOR_A, YES));

    assert.notInStore("Vote", voteId(DELEGATOR_A, POLL));
    assert.entityCount("VoteEvent", 0);
    assert.dataSourceCount("PollTallyTemplate", 0);
  });

  test("a first vote with no stake is recorded, listed and tallied at zero", () => {
    firstVoteWithNoStake();

    let id = voteId(DELEGATOR_A, POLL);
    assert.fieldEquals("Vote", id, "choiceID", "Yes");
    assert.fieldEquals("Vote", id, "voter", DELEGATOR_A.toHex());
    assert.fieldEquals("Vote", id, "poll", POLL.toHex());
    assert.fieldEquals("Vote", id, "voteStake", "0");
    assert.fieldEquals("Vote", id, "registeredTranscoder", "false");
    assert.fieldEquals("Poll", POLL.toHex(), "votes", "[" + id + "]");
    assertTally("0", "0");

    let event = eventId(TX_HASH, 1);
    assert.fieldEquals("VoteEvent", event, "choiceID", "0");
    assert.fieldEquals("VoteEvent", event, "voter", DELEGATOR_A.toHex());
    assert.fieldEquals("VoteEvent", event, "poll", POLL.toHex());
    assert.fieldEquals("VoteEvent", event, "round", CURRENT_ROUND);
  });

  // Matchstick counts template instances by address, so it cannot tell one
  // PollTallyTemplate per voter apart from one in total: every instance
  // watches the same BondingManager address.
  test("a first vote creates a PollTallyTemplate on the BondingManager", () => {
    firstVoteWithNoStake();

    assert.dataSourceCount("PollTallyTemplate", 1);
    assert.dataSourceExists("PollTallyTemplate", BONDING_MANAGER.toHex());
  });

  test("a registered transcoder votes with its total stake", () => {
    seedPoll(POLL, OPEN_POLL_END_BLOCK);

    voteAsRegisteredTranscoderA(YES);

    let id = voteId(TRANSCODER_A, POLL);
    assert.fieldEquals("Vote", id, "voteStake", "1000");
    assert.fieldEquals("Vote", id, "registeredTranscoder", "true");
    assertTally("1000", "0");
  });

  test("a delegator votes with pendingStake, recorded against its delegate", () => {
    seedPoll(POLL, OPEN_POLL_END_BLOCK);
    seedTranscoder(TRANSCODER_A, "Registered", "1000");

    voteAsDelegatorOfTranscoderA(NO, 1);

    assert.fieldEquals("Vote", voteId(DELEGATOR_A, POLL), "voteStake", "100");
    assert.fieldEquals("Vote", voteId(DELEGATOR_A, POLL), "registeredTranscoder", "false");
    let delegateVote = voteId(TRANSCODER_A, POLL);
    assert.fieldEquals("Vote", delegateVote, "voter", TRANSCODER_A.toHex());
    assert.fieldEquals("Vote", delegateVote, "nonVoteStake", "100");
    assert.fieldEquals("Vote", delegateVote, "registeredTranscoder", "true");
    assertTally("0", "100");
  });

  test("a delegator of an unregistered transcoder marks the delegate's vote unregistered", () => {
    seedPoll(POLL, OPEN_POLL_END_BLOCK);
    seedTranscoder(TRANSCODER_A, "NotRegistered", "0");

    voteAsDelegatorOfTranscoderA(YES, 1);

    assert.fieldEquals("Vote", voteId(TRANSCODER_A, POLL), "registeredTranscoder", "false");
    assert.fieldEquals("Vote", voteId(TRANSCODER_A, POLL), "nonVoteStake", "100");
    assertTally("100", "0");
  });

  test("a transcoder and its delegator voting opposite ways split the tally", () => {
    seedPoll(POLL, OPEN_POLL_END_BLOCK);

    voteAsRegisteredTranscoderA(YES);
    voteAsDelegatorOfTranscoderA(NO, 2);

    assertTally("900", "100");
    assert.entityCount("VoteEvent", 2);
  });

  test("changing a vote moves the stake without listing the voter twice", () => {
    seedPoll(POLL, OPEN_POLL_END_BLOCK);
    voteAsRegisteredTranscoderA(YES);

    vote(atLogIndex(createVoteEvent(TRANSCODER_A, NO), 2));

    let id = voteId(TRANSCODER_A, POLL);
    assert.fieldEquals("Vote", id, "choiceID", "No");
    assert.fieldEquals("Vote", id, "voteStake", "1000");
    assert.fieldEquals("Poll", POLL.toHex(), "votes", "[" + id + "]");
    assertTally("0", "1000");
  });

  // BDR-5 known bug: set shouldFail to false when fixed
  test(
    "BDR-5: a first vote does not spawn a PollTallyTemplate per voter",
    () => {
      firstVoteWithNoStake();

      assert.dataSourceCount("PollTallyTemplate", 0);
    },
    true
  );
});

describe("tallyVotes", () => {
  test("a poll with no votes tallies to zero", () => {
    let poll = seedPoll(POLL, OPEN_POLL_END_BLOCK);

    tallyVotes(poll);

    assertTally("0", "0");
  });

  test("nonVoteStake is subtracted only from registered transcoders", () => {
    seedPoll(POLL, OPEN_POLL_END_BLOCK);
    seedCastVote(TRANSCODER_A, POLL, "Yes", "1000", "100", true);
    seedCastVote(TRANSCODER_B, POLL, "No", "500", "50", false);

    tallyVotes(Poll.load(POLL.toHex())!);

    assertTally("900", "500");
  });

  test("a listed vote missing from the store stops the tally without saving it", () => {
    seedPoll(POLL, OPEN_POLL_END_BLOCK);
    seedCastVote(TRANSCODER_A, POLL, "Yes", "1000", "0", true);
    let poll = Poll.load(POLL.toHex())!;
    let votes = poll.votes;
    votes.push("missing-vote");
    poll.votes = votes;
    poll.save();

    tallyVotes(poll);

    assert.notInStore("PollTally", POLL.toHex());
  });
});
