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
import { pollCreated } from "../src/mappings/pollCreator";
import {
  ARBITRUM_ONE,
  CURRENT_ROUND,
  eventId,
  L1_BLOCK,
  POLL,
  TX_HASH,
} from "./helpers/constants";
import { atLogIndex, createPollCreatedEvent } from "./helpers/events";
import { mockBlockNum } from "./helpers/mocks";
import { seedProtocol } from "./helpers/store";

const PROPOSAL_HASH = "QmWBPdeDCi8uxQrUyTV38xwaeYxgmjQmx1Zkiw4vgQhj7x";
const SECOND_POLL = Address.fromString("0x00000000000000000000000000000000000000c2");

beforeEach(() => {
  dataSourceMock.setNetwork(ARBITRUM_ONE);
  seedProtocol();
  mockBlockNum(L1_BLOCK);
});

afterEach(() => {
  clearStore();
});

function createPoll(poll: Address, logIndex: i32): void {
  pollCreated(
    atLogIndex(
      createPollCreatedEvent(
        poll,
        Bytes.fromUTF8(PROPOSAL_HASH),
        BigInt.fromI32(2000),
        BigInt.fromI32(333300),
        BigInt.fromI32(500000)
      ),
      logIndex
    )
  );
}

describe("pollCreated", () => {
  test("creates the poll with an empty vote list and starts its template", () => {
    createPoll(POLL, 1);

    let poll = POLL.toHex();
    assert.fieldEquals("Poll", poll, "proposal", PROPOSAL_HASH);
    assert.fieldEquals("Poll", poll, "endBlock", "2000");
    assert.fieldEquals("Poll", poll, "quorum", "333300");
    assert.fieldEquals("Poll", poll, "quota", "500000");
    assert.fieldEquals("Poll", poll, "tally", poll);
    assert.fieldEquals("Poll", poll, "votes", "[]");
    assert.dataSourceCount("Poll", 1);
    assert.dataSourceExists("Poll", poll);

    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("PollCreatedEvent", id, "poll", poll);
    assert.fieldEquals(
      "PollCreatedEvent",
      id,
      "proposal",
      Bytes.fromUTF8(PROPOSAL_HASH).toHex()
    );
    assert.fieldEquals("PollCreatedEvent", id, "endBlock", "2000");
    assert.fieldEquals("PollCreatedEvent", id, "round", CURRENT_ROUND);
  });

  test("two polls created in one transaction each get a template", () => {
    createPoll(POLL, 1);
    createPoll(SECOND_POLL, 2);

    assert.entityCount("Poll", 2);
    assert.dataSourceCount("Poll", 2);
    assert.dataSourceExists("Poll", SECOND_POLL.toHex());
    assert.entityCount("PollCreatedEvent", 2);
    assert.entityCount("Transaction", 1);
  });
});
