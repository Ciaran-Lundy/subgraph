import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";
import {
  afterEach,
  assert,
  beforeEach,
  clearStore,
  dataSourceMock,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { proposalCreated, voteCast, voteCastWithParams } from "../src/mappings/treasury";
import { TreasuryVote, TreasuryVoteEvent } from "../src/types/schema";
import {
  ARBITRUM_ONE,
  CURRENT_ROUND,
  DELEGATOR_A,
  DELEGATOR_B,
  eventId,
  L1_BLOCK,
  TIMESTAMP,
  tokens,
  TRANSCODER_A,
  TX_HASH,
} from "./helpers/constants";
import {
  atLogIndex,
  createProposalCreatedEvent,
  createVoteCastEvent,
  createVoteCastWithParamsEvent,
} from "./helpers/events";
import { mockBlockNum, mockBlockNumReverts } from "./helpers/mocks";
import { seedProtocol } from "./helpers/store";

const PROPOSAL_ID = BigInt.fromI32(42);
const PROPOSAL = "42";
const AGAINST = 0;
const FOR = 1;
const ABSTAIN = 2;
const CALLDATA = Bytes.fromHexString("0x1234");

beforeEach(() => {
  dataSourceMock.setNetwork(ARBITRUM_ONE);
  seedProtocol();
  mockBlockNum(L1_BLOCK);
});

afterEach(() => {
  clearStore();
});

function createProposal(): void {
  proposalCreated(
    createProposalCreatedEvent(
      PROPOSAL_ID,
      TRANSCODER_A,
      [DELEGATOR_B],
      [BigInt.fromI32(1)],
      [CALLDATA],
      BigInt.fromI32(100),
      BigInt.fromI32(200),
      "Fund the treasury"
    )
  );
}

function castVote(voter: Address, support: i32, weight: i32, logIndex: i32): void {
  voteCast(atLogIndex(createVoteCastEvent(voter, PROPOSAL_ID, support, tokens(weight), ""), logIndex));
}

function treasuryVoteId(voter: Address): string {
  return PROPOSAL + "-" + voter.toHex();
}

describe("proposalCreated", () => {
  test("records the proposal with zeroed vote totals", () => {
    createProposal();

    assert.fieldEquals("TreasuryProposal", PROPOSAL, "proposer", TRANSCODER_A.toHex());
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "targets", "[" + DELEGATOR_B.toHex() + "]");
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "values", "[1]");
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "calldatas", "[0x1234]");
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "voteStart", "100");
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "voteEnd", "200");
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "description", "Fund the treasury");
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "forVotes", "0");
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "totalVotes", "0");
    assert.fieldEquals(
      "LivepeerAccount",
      TRANSCODER_A.toHex(),
      "lastUpdatedTimestamp",
      TIMESTAMP.toString()
    );
  });
});

describe("voteCast", () => {
  test("a For vote adds its weight to forVotes and totalVotes", () => {
    createProposal();

    castVote(DELEGATOR_A, FOR, 100, 2);

    assert.fieldEquals("TreasuryProposal", PROPOSAL, "forVotes", "100");
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "totalVotes", "100");
    let vote = treasuryVoteId(DELEGATOR_A);
    assert.fieldEquals("TreasuryVote", vote, "support", "For");
    assert.fieldEquals("TreasuryVote", vote, "weight", "100");
    assert.fieldEquals("TreasuryVote", vote, "voter", DELEGATOR_A.toHex());
    assert.fieldEquals("TreasuryVote", vote, "proposal", PROPOSAL);
    assert.assertNull(TreasuryVote.load(vote)!.reason);
    let id = eventId(TX_HASH, 2);
    assert.fieldEquals("TreasuryVoteEvent", id, "support", "For");
    assert.fieldEquals("TreasuryVoteEvent", id, "weight", "100");
    assert.fieldEquals("TreasuryVoteEvent", id, "round", CURRENT_ROUND);
    assert.fieldEquals("TreasuryVoteEvent", id, "transaction", TX_HASH.toHex());
    assert.assertNull(TreasuryVoteEvent.load(id)!.reason);
  });

  test("Against and Abstain votes go to their own totals", () => {
    createProposal();

    castVote(DELEGATOR_A, AGAINST, 30, 2);
    castVote(DELEGATOR_B, ABSTAIN, 20, 3);

    assert.fieldEquals("TreasuryProposal", PROPOSAL, "againstVotes", "30");
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "abstainVotes", "20");
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "forVotes", "0");
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "totalVotes", "50");
    assert.fieldEquals("TreasuryVote", treasuryVoteId(DELEGATOR_A), "support", "Against");
    assert.fieldEquals("TreasuryVote", treasuryVoteId(DELEGATOR_B), "support", "Abstain");
  });

  test("a zero-weight vote is recorded without moving the totals", () => {
    createProposal();

    castVote(DELEGATOR_A, FOR, 0, 2);

    assert.fieldEquals("TreasuryVote", treasuryVoteId(DELEGATOR_A), "weight", "0");
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "totalVotes", "0");
  });

  test("a vote on an unknown proposal records nothing and makes no eth_call", () => {
    mockBlockNumReverts();

    castVote(DELEGATOR_A, FOR, 100, 1);

    assert.notInStore("TreasuryVote", treasuryVoteId(DELEGATOR_A));
    assert.entityCount("TreasuryVoteEvent", 0);
  });

  test("an unknown support value is ignored", () => {
    createProposal();

    castVote(DELEGATOR_A, 3, 100, 2);

    assert.notInStore("TreasuryVote", treasuryVoteId(DELEGATOR_A));
    assert.entityCount("TreasuryVoteEvent", 0);
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "totalVotes", "0");
  });
});

describe("voteCastWithParams", () => {
  test("is handled like voteCast and keeps a non-empty reason", () => {
    createProposal();

    voteCastWithParams(
      atLogIndex(
        createVoteCastWithParamsEvent(
          DELEGATOR_A,
          PROPOSAL_ID,
          FOR,
          tokens(100),
          "supports growth",
          Bytes.fromHexString("0xff")
        ),
        2
      )
    );

    assert.fieldEquals("TreasuryVote", treasuryVoteId(DELEGATOR_A), "reason", "supports growth");
    assert.fieldEquals("TreasuryVoteEvent", eventId(TX_HASH, 2), "reason", "supports growth");
    assert.fieldEquals("TreasuryProposal", PROPOSAL, "forVotes", "100");
  });
});
