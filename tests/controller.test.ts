import {
  afterEach,
  assert,
  beforeEach,
  clearStore,
  dataSourceMock,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { pause, unpause } from "../src/mappings/controller";
import {
  ARBITRUM_ONE,
  CURRENT_ROUND,
  eventId,
  L1_BLOCK,
  ROUND_LENGTH,
  TX_HASH,
} from "./helpers/constants";
import { atLogIndex, createPauseEvent, createUnpauseEvent } from "./helpers/events";
import { mockBlockNum, mockRoundLength } from "./helpers/mocks";
import { seedProtocol } from "./helpers/store";

beforeEach(() => {
  dataSourceMock.setNetwork(ARBITRUM_ONE);
  mockBlockNum(L1_BLOCK);
});

afterEach(() => {
  clearStore();
});

describe("pause", () => {
  test("pauses the protocol and records the event", () => {
    seedProtocol();

    pause(createPauseEvent());

    assert.fieldEquals("Protocol", "0", "paused", "true");
    assert.fieldEquals("PauseEvent", eventId(TX_HASH, 1), "round", CURRENT_ROUND);
  });

  test("pausing before any Protocol exists creates it, reading roundLength", () => {
    mockRoundLength(ROUND_LENGTH);

    pause(createPauseEvent());

    assert.fieldEquals("Protocol", "0", "paused", "true");
    assert.fieldEquals("Protocol", "0", "roundLength", ROUND_LENGTH.toString());
    // A fresh Protocol counts 100-block rounds from block 0, so block 1250 is round 12.
    assert.fieldEquals("PauseEvent", eventId(TX_HASH, 1), "round", "12");
  });
});

describe("unpause", () => {
  test("a pause then unpause in one transaction leaves the protocol unpaused", () => {
    seedProtocol();

    pause(createPauseEvent());
    unpause(atLogIndex(createUnpauseEvent(), 2));

    assert.fieldEquals("Protocol", "0", "paused", "false");
    assert.entityCount("PauseEvent", 1);
    assert.fieldEquals("UnpauseEvent", eventId(TX_HASH, 2), "round", CURRENT_ROUND);
    assert.entityCount("Transaction", 1);
  });

  test("unpausing an unpaused protocol keeps it unpaused", () => {
    seedProtocol();

    unpause(createUnpauseEvent());

    assert.fieldEquals("Protocol", "0", "paused", "false");
  });
});
