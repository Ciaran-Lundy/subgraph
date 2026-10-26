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
import { newRound, parameterUpdate } from "../src/mappings/roundsManager";
import { Broadcaster, Protocol, Transcoder } from "../src/types/schema";
import {
  createOrLoadBroadcasterDay,
  createOrLoadTranscoderDay,
  makePoolId,
} from "../utils/helpers";
import {
  ARBITRUM_ONE,
  BROADCASTER,
  CURRENT_ROUND,
  DAY_ID,
  DAY_START,
  eventId,
  L1_BLOCK,
  LPT_ETH_POOL,
  SECONDS_PER_DAY,
  TIMESTAMP,
  tokens,
  TRANSCODER_A,
  TRANSCODER_B,
  TX_HASH,
  ZERO_ADDRESS,
} from "./helpers/constants";
import { createNewRoundEvent, createRoundsManagerParameterUpdateEvent } from "./helpers/events";
import {
  mockBlockNum,
  mockCurrentRound,
  mockFirstTranscoderInPool,
  mockFirstTranscoderInPoolReverts,
  mockLastRoundLengthUpdateRound,
  mockLastRoundLengthUpdateStartBlock,
  mockNextTranscoderInPool,
  mockNextTranscoderInPoolReverts,
  mockRoundLength,
  mockRoundLengthReverts,
  mockRoundLockAmount,
  mockRoundLockAmountReverts,
  mockSlot0,
  mockSlot0Reverts,
  mockTotalBonded,
  mockTotalBondedReverts,
  sqrtPriceX96ForPrice,
} from "./helpers/mocks";
import { decimal, seedBroadcaster, seedProtocol, seedTranscoder } from "./helpers/store";

const BLOCK_HASH = Bytes.fromHexString(
  "0x3333333333333333333333333333333333333333333333333333333333333333"
);
const LAPSED_BROADCASTER = Address.fromString("0x00000000000000000000000000000000000000b2");
// sqrtPrice 2 encodes an LPT price of 4 ETH, give or take the 34-digit
// rounding getPriceForPair applies to Q192.
const LPT_PRICE_SQRT = 2;
const LPT_PRICE_ETH = "4.000000000000000000000000000000001";

beforeEach(() => {
  dataSourceMock.setNetwork(ARBITRUM_ONE);
  seedProtocol();
  mockBlockNum(L1_BLOCK);
});

afterEach(() => {
  clearStore();
});

function startRound12(): void {
  newRound(createNewRoundEvent(BigInt.fromI32(12), BLOCK_HASH));
}

function daysAgo(days: i32): i32 {
  return TIMESTAMP - days * SECONDS_PER_DAY;
}

// An empty pool (getFirstTranscoderInPool returns the zero address, it does
// not revert) with 500 LPT bonded.
function mockEmptyPoolRound(): void {
  mockFirstTranscoderInPool(ZERO_ADDRESS);
  mockTotalBonded(tokens(500));
}

// TRANSCODER_A then TRANSCODER_B are in the pool; TRANSCODER_B's next is mocked
// to end the walk, TRANSCODER_A's next is left to each test.
function mockPoolOfTwo(): void {
  seedTranscoder(TRANSCODER_A, "Registered", "300");
  seedTranscoder(TRANSCODER_B, "Registered", "200");
  mockFirstTranscoderInPool(TRANSCODER_A);
  mockNextTranscoderInPool(TRANSCODER_B, ZERO_ADDRESS);
  mockTotalBonded(tokens(500));
  mockSlot0(LPT_ETH_POOL, sqrtPriceX96ForPrice(LPT_PRICE_SQRT));
}

// Fee volume of 1, 2, 4 and 8 ETH on days 10, 45, 80 and 100 days ago.
function seedTranscoderVolumeHistory(transcoder: Address): void {
  let ages = [10, 45, 80, 100];
  let days = new Array<string>();
  for (let i = 0; i < ages.length; i++) {
    let day = createOrLoadTranscoderDay(daysAgo(ages[i]), transcoder.toHex());
    day.volumeETH = decimal((1 << i).toString());
    day.save();
    days.push(day.id);
  }
  let entity = Transcoder.load(transcoder.toHex())!;
  entity.transcoderDays = days;
  entity.save();
}

function seedBroadcasterVolumeHistory(broadcaster: Address, lastFundedDaysAgo: i32): void {
  seedBroadcaster(broadcaster, "1", "1");
  let ages = [10, 45, 80, 100];
  let days = new Array<string>();
  for (let i = 0; i < ages.length; i++) {
    let day = createOrLoadBroadcasterDay(daysAgo(ages[i]), broadcaster.toHex());
    day.volumeETH = decimal((1 << i).toString());
    day.save();
    days.push(day.id);
  }
  let entity = Broadcaster.load(broadcaster.toHex())!;
  entity.broadcasterDays = days;
  entity.lastFundedDay = daysAgo(lastFundedDaysAgo);
  entity.save();
}

function setProtocolTotals(totalSupply: string, totalActiveStake: string): void {
  let protocol = Protocol.load("0")!;
  protocol.totalSupply = decimal(totalSupply);
  protocol.totalActiveStake = decimal(totalActiveStake);
  protocol.delegatorsCount = BigInt.fromI32(7);
  protocol.inflation = BigInt.fromI32(100);
  protocol.numActiveTranscoders = BigInt.fromI32(100);
  protocol.activeTranscoderCount = BigInt.fromI32(3);
  protocol.save();
}

describe("newRound", () => {
  test("an empty pool initialises the round with no pools", () => {
    mockEmptyPoolRound();
    mockSlot0(LPT_ETH_POOL, sqrtPriceX96ForPrice(LPT_PRICE_SQRT));

    startRound12();

    assert.fieldEquals("Round", CURRENT_ROUND, "initialized", "true");
    assert.fieldEquals("Round", CURRENT_ROUND, "startTimestamp", TIMESTAMP.toString());
    assert.fieldEquals("Round", CURRENT_ROUND, "totalActiveStake", "500");
    assert.fieldEquals("Protocol", "0", "currentRound", CURRENT_ROUND);
    assert.fieldEquals("Protocol", "0", "lastInitializedRound", CURRENT_ROUND);
    assert.fieldEquals("Protocol", "0", "totalActiveStake", "500");
    assert.fieldEquals("Protocol", "0", "lptPriceEth", LPT_PRICE_ETH);
    assert.fieldEquals("Day", DAY_ID, "totalActiveStake", "500");
    assert.entityCount("Pool", 0);
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("NewRoundEvent", id, "blockHash", BLOCK_HASH.toHex());
    assert.fieldEquals("NewRoundEvent", id, "round", CURRENT_ROUND);
  });

  test("with zero total supply, participation and counters are not copied", () => {
    mockEmptyPoolRound();
    mockSlot0(LPT_ETH_POOL, sqrtPriceX96ForPrice(LPT_PRICE_SQRT));
    setProtocolTotals("0", "0");

    startRound12();

    assert.fieldEquals("Protocol", "0", "participationRate", "0");
    assert.fieldEquals("Round", CURRENT_ROUND, "delegatorsCount", "0");
    assert.fieldEquals("Day", DAY_ID, "delegatorsCount", "0");
  });

  test("with stake and supply, participation and counters are copied to round and day", () => {
    mockEmptyPoolRound();
    mockSlot0(LPT_ETH_POOL, sqrtPriceX96ForPrice(LPT_PRICE_SQRT));
    setProtocolTotals("1000", "0");

    startRound12();

    assert.fieldEquals("Protocol", "0", "participationRate", "0.5");
    assert.fieldEquals("Round", CURRENT_ROUND, "participationRate", "0.5");
    assert.fieldEquals("Round", CURRENT_ROUND, "delegatorsCount", "7");
    assert.fieldEquals("Round", CURRENT_ROUND, "inflation", "100");
    assert.fieldEquals("Round", CURRENT_ROUND, "numActiveTranscoders", "100");
    assert.fieldEquals("Round", CURRENT_ROUND, "activeTranscoderCount", "3");
    assert.fieldEquals("Day", DAY_ID, "participationRate", "0.5");
    assert.fieldEquals("Day", DAY_ID, "totalSupply", "1000");
    assert.fieldEquals("Day", DAY_ID, "delegatorsCount", "7");
  });

  test("walks the pool, creating a pool entry per transcoder", () => {
    mockPoolOfTwo();
    mockNextTranscoderInPool(TRANSCODER_A, TRANSCODER_B);

    startRound12();

    let poolA = makePoolId(TRANSCODER_A.toHex(), CURRENT_ROUND);
    let poolB = makePoolId(TRANSCODER_B.toHex(), CURRENT_ROUND);
    assert.fieldEquals("Pool", poolA, "totalStake", "300");
    assert.fieldEquals("Pool", poolA, "fees", "0");
    assert.fieldEquals("Pool", poolB, "totalStake", "200");
    assert.entityCount("Pool", 2);
    assert.fieldEquals("Round", CURRENT_ROUND, "initialized", "true");
  });

  test("sums a walked transcoder's fee volume into 30, 60 and 90 day windows", () => {
    mockPoolOfTwo();
    mockNextTranscoderInPool(TRANSCODER_A, TRANSCODER_B);
    seedTranscoderVolumeHistory(TRANSCODER_B);

    startRound12();

    let transcoder = TRANSCODER_B.toHex();
    assert.fieldEquals("Transcoder", transcoder, "thirtyDayVolumeETH", "1");
    assert.fieldEquals("Transcoder", transcoder, "sixtyDayVolumeETH", "3");
    assert.fieldEquals("Transcoder", transcoder, "ninetyDayVolumeETH", "7");
  });

  test("activates and deactivates the queued transcoders and clears the queues", () => {
    mockEmptyPoolRound();
    mockSlot0(LPT_ETH_POOL, sqrtPriceX96ForPrice(LPT_PRICE_SQRT));
    seedTranscoder(TRANSCODER_A, "Registered", "300");
    let leaving = seedTranscoder(TRANSCODER_B, "Registered", "200");
    leaving.active = true;
    leaving.save();
    let protocol = Protocol.load("0")!;
    protocol.pendingActivation = [TRANSCODER_A.toHex()];
    protocol.pendingDeactivation = [TRANSCODER_B.toHex()];
    protocol.save();

    startRound12();

    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "active", "true");
    assert.fieldEquals("Transcoder", TRANSCODER_B.toHex(), "active", "false");
    assert.fieldEquals("Protocol", "0", "pendingActivation", "[]");
    assert.fieldEquals("Protocol", "0", "pendingDeactivation", "[]");
  });

  test("a reverting getFirstTranscoderInPool skips the pool walk", () => {
    mockFirstTranscoderInPoolReverts();
    mockTotalBonded(tokens(500));
    mockSlot0(LPT_ETH_POOL, sqrtPriceX96ForPrice(LPT_PRICE_SQRT));

    startRound12();

    assert.entityCount("Pool", 0);
    assert.fieldEquals("Round", CURRENT_ROUND, "initialized", "true");
  });

  test("a reverting getTotalBonded records zero active stake", () => {
    mockFirstTranscoderInPool(ZERO_ADDRESS);
    mockTotalBondedReverts();
    mockSlot0(LPT_ETH_POOL, sqrtPriceX96ForPrice(LPT_PRICE_SQRT));
    setProtocolTotals("1000", "300");

    startRound12();

    assert.fieldEquals("Round", CURRENT_ROUND, "totalActiveStake", "0");
    assert.fieldEquals("Protocol", "0", "totalActiveStake", "0");
  });

  test("keeps broadcasters funded in the last 90 days active and refreshes their windows", () => {
    mockEmptyPoolRound();
    mockSlot0(LPT_ETH_POOL, sqrtPriceX96ForPrice(LPT_PRICE_SQRT));
    seedBroadcasterVolumeHistory(BROADCASTER, 10);
    seedBroadcasterVolumeHistory(LAPSED_BROADCASTER, 100);
    let protocol = Protocol.load("0")!;
    protocol.activeBroadcasters = [BROADCASTER.toHex(), LAPSED_BROADCASTER.toHex()];
    protocol.save();

    startRound12();

    assert.fieldEquals("Protocol", "0", "activeBroadcasters", "[" + BROADCASTER.toHex() + "]");
    let broadcaster = BROADCASTER.toHex();
    assert.fieldEquals("Broadcaster", broadcaster, "thirtyDayVolumeETH", "1");
    assert.fieldEquals("Broadcaster", broadcaster, "sixtyDayVolumeETH", "3");
    assert.fieldEquals("Broadcaster", broadcaster, "ninetyDayVolumeETH", "7");
    assert.fieldEquals("Broadcaster", LAPSED_BROADCASTER.toHex(), "ninetyDayVolumeETH", "7");
  });

  test("an empty activeBroadcasters list stays empty", () => {
    mockEmptyPoolRound();
    mockSlot0(LPT_ETH_POOL, sqrtPriceX96ForPrice(LPT_PRICE_SQRT));

    startRound12();

    assert.fieldEquals("Protocol", "0", "activeBroadcasters", "[]");
    assert.fieldEquals("Day", DAY_ID, "date", DAY_START.toString());
  });

  // BDR-6 known bug: set shouldFail to false when fixed
  test(
    "BDR-6: a reverting slot0 call keeps the previous round's lptPriceEth",
    () => {
      mockEmptyPoolRound();
      mockSlot0Reverts(LPT_ETH_POOL);
      let protocol = Protocol.load("0")!;
      protocol.lptPriceEth = decimal("0.005");
      protocol.save();

      startRound12();

      assert.fieldEquals("Protocol", "0", "lptPriceEth", "0.005");
    },
    true
  );

  // BDR-9 known bug: set shouldFail to false when fixed
  test(
    "BDR-9: a reverting getNextTranscoderInPool does not abort the round",
    () => {
      mockPoolOfTwo();
      mockNextTranscoderInPoolReverts(TRANSCODER_A);

      startRound12();

      assert.fieldEquals("Pool", makePoolId(TRANSCODER_A.toHex(), CURRENT_ROUND), "fees", "0");
      assert.fieldEquals("Protocol", "0", "lastInitializedRound", CURRENT_ROUND);
    },
    true
  );
});

describe("parameterUpdate", () => {
  test("roundLength on a protocol with no round length creates the current round", () => {
    let protocol = Protocol.load("0")!;
    protocol.roundLength = BigInt.zero();
    protocol.save();
    mockCurrentRound(BigInt.fromI32(12));
    mockRoundLength(BigInt.fromI32(100));
    mockLastRoundLengthUpdateStartBlock(BigInt.fromI32(1000));
    mockLastRoundLengthUpdateRound(BigInt.fromI32(10));

    parameterUpdate(createRoundsManagerParameterUpdateEvent("roundLength"));

    assert.fieldEquals("Protocol", "0", "roundLength", "100");
    assert.fieldEquals("Protocol", "0", "lastRoundLengthUpdateStartBlock", "1000");
    assert.fieldEquals("Protocol", "0", "lastRoundLengthUpdateRound", "10");
    assert.fieldEquals("Protocol", "0", "currentRound", CURRENT_ROUND);
    assert.fieldEquals("Round", CURRENT_ROUND, "startBlock", L1_BLOCK.toString());
    assert.fieldEquals("Round", CURRENT_ROUND, "length", "100");
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("ParameterUpdateEvent", id, "param", "roundLength");
    assert.fieldEquals("ParameterUpdateEvent", id, "round", CURRENT_ROUND);
  });

  test("roundLength on an initialised protocol updates it without creating a round", () => {
    mockCurrentRound(BigInt.fromI32(12));
    mockRoundLength(BigInt.fromI32(50));
    mockLastRoundLengthUpdateStartBlock(BigInt.fromI32(1200));
    mockLastRoundLengthUpdateRound(BigInt.fromI32(12));

    parameterUpdate(createRoundsManagerParameterUpdateEvent("roundLength"));

    assert.fieldEquals("Protocol", "0", "roundLength", "50");
    assert.fieldEquals("Protocol", "0", "lastRoundLengthUpdateStartBlock", "1200");
    assert.fieldEquals("Protocol", "0", "lastRoundLengthUpdateRound", "12");
    assert.notInStore("Round", CURRENT_ROUND);
  });

  test("roundLockAmount sets the lock period as a fraction of the round length", () => {
    mockCurrentRound(BigInt.fromI32(12));
    mockRoundLength(BigInt.fromI32(100));
    mockRoundLockAmount(BigInt.fromI32(100000));

    parameterUpdate(createRoundsManagerParameterUpdateEvent("roundLockAmount"));

    assert.fieldEquals("Protocol", "0", "roundLockAmount", "100000");
    assert.fieldEquals("Protocol", "0", "lockPeriod", "10");
  });

  test("an unrelated parameter leaves the protocol unchanged", () => {
    mockCurrentRound(BigInt.fromI32(12));
    mockRoundLengthReverts();
    mockRoundLockAmountReverts();

    parameterUpdate(createRoundsManagerParameterUpdateEvent("somethingElse"));

    assert.fieldEquals("Protocol", "0", "roundLength", "100");
    assert.fieldEquals("Protocol", "0", "lockPeriod", "0");
    assert.fieldEquals("ParameterUpdateEvent", eventId(TX_HASH, 1), "round", CURRENT_ROUND);
  });
});
