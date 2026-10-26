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
import { burn, mint } from "../src/mappings/livepeerToken";
import { Protocol } from "../src/types/schema";
import {
  ARBITRUM_ONE,
  CURRENT_ROUND,
  DAY_ID,
  DELEGATOR_A,
  eventId,
  L1_BLOCK,
  tokens,
  TX_HASH,
} from "./helpers/constants";
import { atLogIndex, createBurnEvent, createMintEvent } from "./helpers/events";
import {
  mockBlockNum,
  mockGlobalTotalSupply,
  mockGlobalTotalSupplyReverts,
} from "./helpers/mocks";
import { decimal, seedProtocol } from "./helpers/store";

const PREVIOUS_PARTICIPATION_RATE = "0.25";

beforeEach(() => {
  dataSourceMock.setNetwork(ARBITRUM_ONE);
  seedProtocol();
  mockBlockNum(L1_BLOCK);
});

afterEach(() => {
  clearStore();
});

function setSupplyAndActiveStake(totalSupply: string, totalActiveStake: string): void {
  let protocol = Protocol.load("0")!;
  protocol.totalSupply = decimal(totalSupply);
  protocol.totalActiveStake = decimal(totalActiveStake);
  protocol.participationRate = decimal(PREVIOUS_PARTICIPATION_RATE);
  protocol.save();
}

// 400 LPT is staked when the Minter reports `globalSupply` LPT after a 10 LPT mint.
function mintWithReportedSupply(globalSupply: i32): void {
  setSupplyAndActiveStake("990", "400");
  mockGlobalTotalSupply(tokens(globalSupply));
  mint(createMintEvent(DELEGATOR_A, tokens(10)));
}

// 400 LPT is staked when `amount` LPT is burnt from a `previousSupply` LPT
// supply, before the current Minter exists (getGlobalTotalSupply reverts).
function burnBeforeCurrentMinter(previousSupply: string, amount: i32): void {
  setSupplyAndActiveStake(previousSupply, "400");
  mockGlobalTotalSupplyReverts();
  burn(createBurnEvent(DELEGATOR_A, tokens(amount)));
}

describe("mint", () => {
  test("takes total supply from the Minter and recomputes participation", () => {
    mintWithReportedSupply(1000);

    assert.fieldEquals("Protocol", "0", "totalSupply", "1000");
    assert.fieldEquals("Protocol", "0", "participationRate", "0.4");
    assert.fieldEquals("Day", DAY_ID, "totalSupply", "1000");
    assert.fieldEquals("Day", DAY_ID, "totalActiveStake", "400");
    assert.fieldEquals("Day", DAY_ID, "participationRate", "0.4");
    assert.fieldEquals("Round", CURRENT_ROUND, "totalSupply", "1000");
    assert.fieldEquals("Round", CURRENT_ROUND, "participationRate", "0.4");
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("MintEvent", id, "to", DELEGATOR_A.toHex());
    assert.fieldEquals("MintEvent", id, "amount", "10");
    assert.fieldEquals("MintEvent", id, "round", CURRENT_ROUND);
  });

  test("before the current Minter exists, adds the minted amount to the previous supply", () => {
    setSupplyAndActiveStake("1000", "0");
    mockGlobalTotalSupplyReverts();

    mint(createMintEvent(DELEGATOR_A, tokens(10)));

    assert.fieldEquals("Protocol", "0", "totalSupply", "1010");
    assert.fieldEquals("Round", CURRENT_ROUND, "totalSupply", "1010");
  });

  test("with nothing staked, participation is left unchanged", () => {
    setSupplyAndActiveStake("990", "0");
    mockGlobalTotalSupply(tokens(1000));

    mint(createMintEvent(DELEGATOR_A, tokens(10)));

    assert.fieldEquals("Protocol", "0", "participationRate", PREVIOUS_PARTICIPATION_RATE);
    assert.fieldEquals("Day", DAY_ID, "participationRate", "0");
    assert.fieldEquals("Round", CURRENT_ROUND, "participationRate", PREVIOUS_PARTICIPATION_RATE);
  });

  test("consecutive mints in one block accumulate the fallback supply", () => {
    setSupplyAndActiveStake("1000", "0");
    mockGlobalTotalSupplyReverts();

    mint(createMintEvent(DELEGATOR_A, tokens(10)));
    mint(atLogIndex(createMintEvent(DELEGATOR_A, tokens(5)), 2));

    assert.fieldEquals("Protocol", "0", "totalSupply", "1015");
    assert.fieldEquals("Day", DAY_ID, "totalSupply", "1015");
    assert.entityCount("MintEvent", 2);
  });

  // BDR-8 known bug: set shouldFail to false when fixed
  test(
    "BDR-8: a zero total supply does not abort and leaves participation unchanged",
    () => {
      mintWithReportedSupply(0);

      assert.fieldEquals("Protocol", "0", "totalSupply", "0");
      assert.fieldEquals("Protocol", "0", "participationRate", PREVIOUS_PARTICIPATION_RATE);
    },
    true
  );
});

describe("burn", () => {
  test("takes total supply from the Minter and recomputes participation", () => {
    setSupplyAndActiveStake("1010", "400");
    mockGlobalTotalSupply(tokens(1000));

    burn(createBurnEvent(DELEGATOR_A, tokens(10)));

    assert.fieldEquals("Protocol", "0", "totalSupply", "1000");
    assert.fieldEquals("Protocol", "0", "participationRate", "0.4");
    assert.fieldEquals("Day", DAY_ID, "participationRate", "0.4");
    assert.fieldEquals("Round", CURRENT_ROUND, "totalSupply", "1000");
    assert.fieldEquals("BurnEvent", eventId(TX_HASH, 1), "value", "10");
  });

  test("before the current Minter exists, subtracts the burnt amount from the previous supply", () => {
    burnBeforeCurrentMinter("1010", 10);

    assert.fieldEquals("Protocol", "0", "totalSupply", "1000");
    assert.fieldEquals("Protocol", "0", "participationRate", "0.4");
  });

  test("with nothing staked, participation is left unchanged", () => {
    setSupplyAndActiveStake("1010", "0");
    mockGlobalTotalSupply(tokens(1000));

    burn(createBurnEvent(DELEGATOR_A, tokens(10)));

    assert.fieldEquals("Protocol", "0", "participationRate", PREVIOUS_PARTICIPATION_RATE);
  });

  // BDR-8 known bug: set shouldFail to false when fixed
  test(
    "BDR-8: burning the whole supply does not abort and leaves participation unchanged",
    () => {
      burnBeforeCurrentMinter("10", 10);

      assert.fieldEquals("Protocol", "0", "totalSupply", "0");
      assert.fieldEquals("Protocol", "0", "participationRate", PREVIOUS_PARTICIPATION_RATE);
    },
    true
  );
});
