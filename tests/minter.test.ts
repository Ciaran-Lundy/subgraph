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
import { parameterUpdate, setCurrentRewardTokens } from "../src/mappings/minter";
import {
  ARBITRUM_ONE,
  CURRENT_ROUND,
  eventId,
  L1_BLOCK,
  tokens,
  TX_HASH,
} from "./helpers/constants";
import {
  atLogIndex,
  createMinterParameterUpdateEvent,
  createSetCurrentRewardTokensEvent,
} from "./helpers/events";
import {
  mockBlockNum,
  mockInflation,
  mockInflationChange,
  mockInflationChangeReverts,
  mockTargetBondingRate,
  mockTargetBondingRateReverts,
} from "./helpers/mocks";
import { seedProtocol } from "./helpers/store";

beforeEach(() => {
  dataSourceMock.setNetwork(ARBITRUM_ONE);
  seedProtocol();
  mockBlockNum(L1_BLOCK);
});

afterEach(() => {
  clearStore();
});

function mockMinterParameters(inflation: i32): void {
  mockTargetBondingRate(BigInt.fromI32(500000));
  mockInflationChange(BigInt.fromI32(500));
  mockInflation(BigInt.fromI32(inflation));
}

describe("setCurrentRewardTokens", () => {
  test("refreshes the inflation parameters and records the round's mintable tokens", () => {
    mockMinterParameters(250000);

    setCurrentRewardTokens(
      createSetCurrentRewardTokensEvent(tokens(1000), BigInt.fromI32(250000))
    );

    assert.fieldEquals("Protocol", "0", "targetBondingRate", "500000");
    assert.fieldEquals("Protocol", "0", "inflationChange", "500");
    assert.fieldEquals("Protocol", "0", "inflation", "250000");
    assert.fieldEquals("Round", CURRENT_ROUND, "mintableTokens", "1000");
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("SetCurrentRewardTokensEvent", id, "currentMintableTokens", "1000");
    assert.fieldEquals("SetCurrentRewardTokensEvent", id, "currentInflation", "250000");
    assert.fieldEquals("SetCurrentRewardTokensEvent", id, "round", CURRENT_ROUND);
  });

  test("zero mintable tokens are recorded as zero", () => {
    mockMinterParameters(0);

    setCurrentRewardTokens(createSetCurrentRewardTokensEvent(BigInt.zero(), BigInt.zero()));

    assert.fieldEquals("Round", CURRENT_ROUND, "mintableTokens", "0");
    assert.fieldEquals("Protocol", "0", "inflation", "0");
  });

  test("a second event in the same round overwrites the mintable tokens", () => {
    mockMinterParameters(250000);

    setCurrentRewardTokens(
      createSetCurrentRewardTokensEvent(tokens(1000), BigInt.fromI32(250000))
    );
    setCurrentRewardTokens(
      atLogIndex(createSetCurrentRewardTokensEvent(tokens(900), BigInt.fromI32(250000)), 2)
    );

    assert.fieldEquals("Round", CURRENT_ROUND, "mintableTokens", "900");
    assert.entityCount("SetCurrentRewardTokensEvent", 2);
  });
});

describe("parameterUpdate", () => {
  test("targetBondingRate is read from the Minter", () => {
    mockTargetBondingRate(BigInt.fromI32(400000));
    mockInflationChangeReverts();

    parameterUpdate(createMinterParameterUpdateEvent("targetBondingRate"));

    assert.fieldEquals("Protocol", "0", "targetBondingRate", "400000");
    assert.fieldEquals("Protocol", "0", "inflationChange", "0");
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("ParameterUpdateEvent", id, "param", "targetBondingRate");
    assert.fieldEquals("ParameterUpdateEvent", id, "round", CURRENT_ROUND);
  });

  test("inflationChange is read from the Minter", () => {
    mockInflationChange(BigInt.fromI32(300));
    mockTargetBondingRateReverts();

    parameterUpdate(createMinterParameterUpdateEvent("inflationChange"));

    assert.fieldEquals("Protocol", "0", "inflationChange", "300");
    assert.fieldEquals("Protocol", "0", "targetBondingRate", "0");
  });

  test("an unrelated parameter makes no Minter call", () => {
    mockTargetBondingRateReverts();
    mockInflationChangeReverts();

    parameterUpdate(createMinterParameterUpdateEvent("somethingElse"));

    assert.fieldEquals("Protocol", "0", "targetBondingRate", "0");
    assert.fieldEquals("Protocol", "0", "inflationChange", "0");
    assert.fieldEquals("ParameterUpdateEvent", eventId(TX_HASH, 1), "param", "somethingElse");
  });
});
