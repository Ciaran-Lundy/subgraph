import { Address, BigInt, DataSourceContext } from "@graphprotocol/graph-ts";
import {
  afterEach,
  assert,
  beforeEach,
  clearStore,
  dataSourceMock,
  describe,
  test,
} from "matchstick-as/assembly/index";
import {
  updatePollTallyOnBond,
  updatePollTallyOnRebond,
  updatePollTallyOnReward,
  updatePollTallyOnUnbond,
} from "../src/mappings/pollTallyHandlers";
import {
  ARBITRUM_ONE,
  DELEGATOR_A,
  DELEGATOR_B,
  L1_BLOCK,
  POLL,
  tokens,
  TRANSCODER_A,
  TRANSCODER_B,
} from "./helpers/constants";
import {
  createBondEvent,
  createRebondEvent,
  createRewardEvent,
  createUnbondEvent,
} from "./helpers/events";
import { mockBlockNum, mockPendingStake, mockPendingStakeReverts } from "./helpers/mocks";
import {
  seedCastVote,
  seedDelegator,
  seedPoll,
  seedProtocol,
  seedTranscoder,
  voteId,
} from "./helpers/store";

// Poll windows are compared against the mocked L1 block number (1250).
const OPEN_POLL_END_BLOCK = BigInt.fromI32(2000);
const ENDED_POLL_END_BLOCK = BigInt.fromI32(1000);
const CURRENT_ROUND_NUMBER = BigInt.fromI32(12);

beforeEach(() => {
  seedProtocol();
  mockBlockNum(L1_BLOCK);
});

afterEach(() => {
  clearStore();
});

// Each PollTallyTemplate instance carries the poll and the voter it was
// created for (see vote() in poll.ts).
function runAsTemplateFor(voter: Address): void {
  let context = new DataSourceContext();
  context.setString("poll", POLL.toHex());
  context.setString("voter", voter.toHex());
  dataSourceMock.setNetworkAndContext(ARBITRUM_ONE, context);
}

function assertTally(yes: string, no: string): void {
  assert.fieldEquals("PollTally", POLL.toHex(), "yes", yes);
  assert.fieldEquals("PollTally", POLL.toHex(), "no", no);
}

// ---------------------------------------------------------------------------
// updatePollTallyOnBond
// ---------------------------------------------------------------------------

// TRANSCODER_A (1000 LPT, voted Yes) and its delegator DELEGATOR_A (100 LPT,
// voted No). The main bond() handler has already raised TRANSCODER_A's stake
// to 1050 when DELEGATOR_A bonds another 50.
function delegatorAAddsStakeToTranscoderA(): void {
  seedPoll(POLL, OPEN_POLL_END_BLOCK);
  seedTranscoder(TRANSCODER_A, "Registered", "1050");
  seedCastVote(TRANSCODER_A, POLL, "Yes", "1000", "100", true);
  seedCastVote(DELEGATOR_A, POLL, "No", "100", "0", false);
  updatePollTallyOnBond(
    createBondEvent(TRANSCODER_A, TRANSCODER_A, DELEGATOR_A, tokens(50), tokens(150))
  );
}

// TRANSCODER_A voted Yes and is self-delegated with 900 LPT of its own plus
// DELEGATOR_A's 100 LPT (DELEGATOR_A voted No). TRANSCODER_A moves its own
// 900 LPT to TRANSCODER_B; the main bond() handler has already deregistered
// TRANSCODER_A and left it with DELEGATOR_A's 100 LPT.
function selfDelegatedVoterSwitchesToTranscoderB(): void {
  runAsTemplateFor(TRANSCODER_A);
  seedPoll(POLL, OPEN_POLL_END_BLOCK);
  seedTranscoder(TRANSCODER_A, "NotRegistered", "100");
  seedTranscoder(TRANSCODER_B, "Registered", "1400");
  seedCastVote(TRANSCODER_A, POLL, "Yes", "1000", "100", true);
  seedCastVote(DELEGATOR_A, POLL, "No", "100", "0", false);
  updatePollTallyOnBond(
    createBondEvent(TRANSCODER_B, TRANSCODER_A, TRANSCODER_A, BigInt.zero(), tokens(900))
  );
}

describe("updatePollTallyOnBond", () => {
  test("an ended poll is left untouched", () => {
    runAsTemplateFor(DELEGATOR_A);
    seedPoll(POLL, ENDED_POLL_END_BLOCK);

    updatePollTallyOnBond(
      createBondEvent(TRANSCODER_A, TRANSCODER_A, DELEGATOR_A, tokens(50), tokens(150))
    );

    assert.entityCount("Vote", 0);
    assert.notInStore("PollTally", POLL.toHex());
  });

  test("a poll that is not stored is left untouched", () => {
    runAsTemplateFor(DELEGATOR_A);

    updatePollTallyOnBond(
      createBondEvent(TRANSCODER_A, TRANSCODER_A, DELEGATOR_A, tokens(50), tokens(150))
    );

    assert.entityCount("Vote", 0);
    assert.notInStore("PollTally", POLL.toHex());
  });

  test("the voter adding stake updates its vote and its delegate's nonVoteStake", () => {
    runAsTemplateFor(DELEGATOR_A);
    delegatorAAddsStakeToTranscoderA();

    let delegateVote = voteId(TRANSCODER_A, POLL);
    assert.fieldEquals("Vote", delegateVote, "voteStake", "1050");
    assert.fieldEquals("Vote", delegateVote, "nonVoteStake", "150");
    assert.fieldEquals("Vote", delegateVote, "registeredTranscoder", "true");
    assert.fieldEquals("Vote", voteId(DELEGATOR_A, POLL), "voteStake", "150");
    assertTally("900", "150");
  });

  test("the voter switching delegates moves its stake between their nonVoteStake", () => {
    runAsTemplateFor(DELEGATOR_A);
    seedPoll(POLL, OPEN_POLL_END_BLOCK);
    seedTranscoder(TRANSCODER_A, "Registered", "900");
    seedTranscoder(TRANSCODER_B, "Registered", "600");
    seedCastVote(TRANSCODER_A, POLL, "Yes", "1000", "100", true);
    seedCastVote(TRANSCODER_B, POLL, "No", "500", "0", true);
    seedCastVote(DELEGATOR_A, POLL, "Yes", "100", "0", false);

    updatePollTallyOnBond(
      createBondEvent(TRANSCODER_B, TRANSCODER_A, DELEGATOR_A, BigInt.zero(), tokens(100))
    );

    assert.fieldEquals("Vote", voteId(TRANSCODER_A, POLL), "voteStake", "900");
    assert.fieldEquals("Vote", voteId(TRANSCODER_A, POLL), "nonVoteStake", "0");
    assert.fieldEquals("Vote", voteId(TRANSCODER_B, POLL), "voteStake", "600");
    assert.fieldEquals("Vote", voteId(TRANSCODER_B, POLL), "nonVoteStake", "100");
    assert.fieldEquals("Vote", voteId(DELEGATOR_A, POLL), "voteStake", "100");
    assertTally("1000", "500");
  });

  test("a bond by another account only refreshes the delegates' votes", () => {
    runAsTemplateFor(DELEGATOR_B);
    delegatorAAddsStakeToTranscoderA();

    assert.fieldEquals("Vote", voteId(TRANSCODER_A, POLL), "voteStake", "1050");
    assert.fieldEquals("Vote", voteId(TRANSCODER_A, POLL), "nonVoteStake", "100");
    assert.fieldEquals("Vote", voteId(DELEGATOR_A, POLL), "voteStake", "100");
    assertTally("950", "100");
  });

  // BDR-5: every voter's template instance handles the same Bond. Running the
  // other voter's instance after the bonding voter's must not change the result.
  test("a second template instance handling the same bond leaves the tally unchanged", () => {
    runAsTemplateFor(DELEGATOR_A);
    delegatorAAddsStakeToTranscoderA();
    seedCastVote(DELEGATOR_B, POLL, "Yes", "0", "0", false);

    runAsTemplateFor(DELEGATOR_B);
    updatePollTallyOnBond(
      createBondEvent(TRANSCODER_A, TRANSCODER_A, DELEGATOR_A, tokens(50), tokens(150))
    );

    assert.fieldEquals("Vote", voteId(TRANSCODER_A, POLL), "nonVoteStake", "150");
    assert.fieldEquals("Vote", voteId(DELEGATOR_A, POLL), "voteStake", "150");
    assertTally("900", "150");
  });

  test("a self-delegated voter switching delegates moves its stake to the new delegate", () => {
    selfDelegatedVoterSwitchesToTranscoderB();

    let newDelegateVote = voteId(TRANSCODER_B, POLL);
    assert.fieldEquals("Vote", newDelegateVote, "voter", TRANSCODER_B.toHex());
    assert.fieldEquals("Vote", newDelegateVote, "nonVoteStake", "900");
    assert.fieldEquals("Vote", newDelegateVote, "registeredTranscoder", "true");
    assert.fieldEquals("Vote", voteId(TRANSCODER_A, POLL), "voteStake", "900");
  });

  // BDR-43 known bug: set shouldFail to false when fixed
  // The voter is also the old delegate, so `oldDelegateVote` and `vote` are two
  // copies of one Vote. The second save restores the stale registeredTranscoder
  // and nonVoteStake, and the tally subtracts nonVoteStake from a voter that is
  // no longer a registered transcoder (800 Yes instead of 900).
  test(
    "BDR-43: a self-delegated voter switching delegates keeps the old-delegate update",
    () => {
      selfDelegatedVoterSwitchesToTranscoderB();

      assert.fieldEquals("Vote", voteId(TRANSCODER_A, POLL), "registeredTranscoder", "false");
      assertTally("900", "100");
    },
    true
  );
});

// ---------------------------------------------------------------------------
// updatePollTallyOnReward
// ---------------------------------------------------------------------------

// TRANSCODER_A (now 1010 LPT after the reward) voted Yes; its delegator
// DELEGATOR_A voted No with 100 LPT.
function seedRewardPoll(endBlock: BigInt): void {
  seedPoll(POLL, endBlock);
  seedTranscoder(TRANSCODER_A, "Registered", "1010");
  seedDelegator(TRANSCODER_A, TRANSCODER_A, "1000");
  seedDelegator(DELEGATOR_A, TRANSCODER_A, "100");
  seedCastVote(TRANSCODER_A, POLL, "Yes", "1000", "100", true);
  seedCastVote(DELEGATOR_A, POLL, "No", "100", "0", false);
}

describe("updatePollTallyOnReward", () => {
  test("a voter with no Delegator entity is ignored", () => {
    runAsTemplateFor(DELEGATOR_B);
    seedRewardPoll(OPEN_POLL_END_BLOCK);

    updatePollTallyOnReward(createRewardEvent(TRANSCODER_A, tokens(10)));

    assert.fieldEquals("Vote", voteId(TRANSCODER_A, POLL), "voteStake", "1000");
    assert.notInStore("PollTally", POLL.toHex());
  });

  test("a reward by a transcoder other than the voter's delegate is ignored", () => {
    runAsTemplateFor(DELEGATOR_A);
    seedRewardPoll(OPEN_POLL_END_BLOCK);

    updatePollTallyOnReward(createRewardEvent(TRANSCODER_B, tokens(10)));

    assert.fieldEquals("Vote", voteId(DELEGATOR_A, POLL), "voteStake", "100");
    assert.notInStore("PollTally", POLL.toHex());
  });

  test("a transcoder voter's vote takes its new total stake", () => {
    runAsTemplateFor(TRANSCODER_A);
    seedRewardPoll(OPEN_POLL_END_BLOCK);

    updatePollTallyOnReward(createRewardEvent(TRANSCODER_A, tokens(10)));

    assert.fieldEquals("Vote", voteId(TRANSCODER_A, POLL), "voteStake", "1010");
    assertTally("910", "100");
  });

  test("a delegator voter's stake comes from pendingStake and moves its delegate's nonVoteStake", () => {
    runAsTemplateFor(DELEGATOR_A);
    seedRewardPoll(OPEN_POLL_END_BLOCK);
    let transcoderVote = voteId(TRANSCODER_A, POLL);
    mockPendingStake(DELEGATOR_A, CURRENT_ROUND_NUMBER, tokens(105));

    updatePollTallyOnReward(createRewardEvent(TRANSCODER_A, tokens(10)));

    assert.fieldEquals("Vote", voteId(DELEGATOR_A, POLL), "voteStake", "105");
    assert.fieldEquals("Vote", transcoderVote, "nonVoteStake", "105");
    assert.fieldEquals("Vote", transcoderVote, "voter", TRANSCODER_A.toHex());
    // The transcoder's own voteStake is refreshed by its own template instance.
    assertTally("895", "105");
  });

  test("an ended poll is left untouched and pendingStake is not called", () => {
    runAsTemplateFor(DELEGATOR_A);
    seedRewardPoll(ENDED_POLL_END_BLOCK);
    mockPendingStakeReverts(DELEGATOR_A, CURRENT_ROUND_NUMBER);

    updatePollTallyOnReward(createRewardEvent(TRANSCODER_A, tokens(10)));

    assert.fieldEquals("Vote", voteId(DELEGATOR_A, POLL), "voteStake", "100");
    assert.notInStore("PollTally", POLL.toHex());
  });
});

// ---------------------------------------------------------------------------
// updatePollTallyOnUnbond and updatePollTallyOnRebond
// ---------------------------------------------------------------------------

// TRANSCODER_A voted Yes with 1000 LPT; DELEGATOR_A voted No with 100 LPT and
// changes its stake to 50 LPT. The main handler has already set TRANSCODER_A's
// stake to 950.
function seedStakeChangePoll(endBlock: BigInt, transcoderStatus: string): void {
  seedPoll(POLL, endBlock);
  seedTranscoder(TRANSCODER_A, transcoderStatus, "950");
  seedCastVote(TRANSCODER_A, POLL, "Yes", "1000", "100", transcoderStatus == "Registered");
  seedCastVote(DELEGATOR_A, POLL, "No", "100", "0", false);
}

function unbondDelegatorAFromTranscoderA(): void {
  updatePollTallyOnUnbond(
    createUnbondEvent(TRANSCODER_A, DELEGATOR_A, BigInt.zero(), tokens(50), BigInt.fromI32(19))
  );
}

describe("updatePollTallyOnUnbond", () => {
  test("the voter unbonding updates its vote and its delegate's nonVoteStake", () => {
    runAsTemplateFor(DELEGATOR_A);
    seedStakeChangePoll(OPEN_POLL_END_BLOCK, "Registered");
    mockPendingStake(DELEGATOR_A, CURRENT_ROUND_NUMBER, tokens(50));

    unbondDelegatorAFromTranscoderA();

    let transcoderVote = voteId(TRANSCODER_A, POLL);
    assert.fieldEquals("Vote", transcoderVote, "voteStake", "950");
    assert.fieldEquals("Vote", transcoderVote, "nonVoteStake", "50");
    assert.fieldEquals("Vote", transcoderVote, "registeredTranscoder", "true");
    assert.fieldEquals("Vote", voteId(DELEGATOR_A, POLL), "voteStake", "50");
    assertTally("900", "50");
  });

  test("an unregistered delegate's vote takes its pendingStake", () => {
    runAsTemplateFor(DELEGATOR_B);
    seedStakeChangePoll(OPEN_POLL_END_BLOCK, "NotRegistered");
    mockPendingStake(TRANSCODER_A, CURRENT_ROUND_NUMBER, tokens(400));

    unbondDelegatorAFromTranscoderA();

    assert.fieldEquals("Vote", voteId(TRANSCODER_A, POLL), "voteStake", "400");
    assert.fieldEquals("Vote", voteId(TRANSCODER_A, POLL), "registeredTranscoder", "false");
    // nonVoteStake only counts against registered transcoders.
    assertTally("400", "100");
  });

  test("an ended poll is left untouched and pendingStake is not called", () => {
    runAsTemplateFor(DELEGATOR_A);
    seedStakeChangePoll(ENDED_POLL_END_BLOCK, "Registered");
    mockPendingStakeReverts(DELEGATOR_A, CURRENT_ROUND_NUMBER);

    unbondDelegatorAFromTranscoderA();

    assert.fieldEquals("Vote", voteId(DELEGATOR_A, POLL), "voteStake", "100");
    assert.notInStore("PollTally", POLL.toHex());
  });
});

describe("updatePollTallyOnRebond", () => {
  test("the voter rebonding updates its vote and its delegate's nonVoteStake", () => {
    runAsTemplateFor(DELEGATOR_A);
    seedStakeChangePoll(OPEN_POLL_END_BLOCK, "Registered");
    mockPendingStake(DELEGATOR_A, CURRENT_ROUND_NUMBER, tokens(150));

    updatePollTallyOnRebond(
      createRebondEvent(TRANSCODER_A, DELEGATOR_A, BigInt.zero(), tokens(50))
    );

    assert.fieldEquals("Vote", voteId(TRANSCODER_A, POLL), "nonVoteStake", "150");
    assert.fieldEquals("Vote", voteId(DELEGATOR_A, POLL), "voteStake", "150");
    assertTally("800", "150");
  });

  test("an ended poll is left untouched", () => {
    runAsTemplateFor(DELEGATOR_A);
    seedStakeChangePoll(ENDED_POLL_END_BLOCK, "Registered");
    mockPendingStakeReverts(DELEGATOR_A, CURRENT_ROUND_NUMBER);

    updatePollTallyOnRebond(
      createRebondEvent(TRANSCODER_A, DELEGATOR_A, BigInt.zero(), tokens(50))
    );

    assert.fieldEquals("Vote", voteId(DELEGATOR_A, POLL), "voteStake", "100");
    assert.notInStore("PollTally", POLL.toHex());
  });
});
