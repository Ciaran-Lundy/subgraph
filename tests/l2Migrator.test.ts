import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  afterEach,
  assert,
  beforeEach,
  clearStore,
  dataSourceMock,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { migrateDelegatorFinalized, stakeClaimed } from "../src/mappings/l2Migrator";
import {
  ARBITRUM_ONE,
  CURRENT_ROUND,
  DELEGATOR_A,
  DELEGATOR_B,
  eventId,
  L1_BLOCK,
  tokens,
  TRANSCODER_A,
  TX_HASH,
} from "./helpers/constants";
import {
  atLogIndex,
  createMigrateDelegatorFinalizedEvent,
  createStakeClaimedEvent,
} from "./helpers/events";
import { mockBlockNum } from "./helpers/mocks";
import { seedProtocol } from "./helpers/store";

beforeEach(() => {
  dataSourceMock.setNetwork(ARBITRUM_ONE);
  seedProtocol();
  mockBlockNum(L1_BLOCK);
});

afterEach(() => {
  clearStore();
});

function migrate(l1Addr: Address, l2Addr: Address): void {
  migrateDelegatorFinalized(
    createMigrateDelegatorFinalizedEvent(
      l1Addr,
      l2Addr,
      tokens(100),
      tokens(250),
      tokens(3),
      TRANSCODER_A
    )
  );
}

describe("migrateDelegatorFinalized", () => {
  test("records the migrated stake, fees and delegate", () => {
    migrate(DELEGATOR_A, DELEGATOR_B);

    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("MigrateDelegatorFinalizedEvent", id, "l1Addr", DELEGATOR_A.toHex());
    assert.fieldEquals("MigrateDelegatorFinalizedEvent", id, "stake", "100");
    assert.fieldEquals("MigrateDelegatorFinalizedEvent", id, "delegatedStake", "250");
    assert.fieldEquals("MigrateDelegatorFinalizedEvent", id, "fees", "3");
    assert.fieldEquals("MigrateDelegatorFinalizedEvent", id, "delegate", TRANSCODER_A.toHex());
    assert.fieldEquals("MigrateDelegatorFinalizedEvent", id, "round", CURRENT_ROUND);
  });

  test("a migration to the same address records it as both l1Addr and l2Addr", () => {
    migrate(DELEGATOR_A, DELEGATOR_A);

    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("MigrateDelegatorFinalizedEvent", id, "l1Addr", DELEGATOR_A.toHex());
    assert.fieldEquals("MigrateDelegatorFinalizedEvent", id, "l2Addr", DELEGATOR_A.toHex());
  });

  // BDR-2 known bug: set shouldFail to false when fixed
  test(
    "BDR-2: a migration to a different L2 address records that address as l2Addr",
    () => {
      migrate(DELEGATOR_A, DELEGATOR_B);

      assert.fieldEquals(
        "MigrateDelegatorFinalizedEvent",
        eventId(TX_HASH, 1),
        "l2Addr",
        DELEGATOR_B.toHex()
      );
    },
    true
  );
});

describe("stakeClaimed", () => {
  test("records the claimed stake and fees", () => {
    stakeClaimed(createStakeClaimedEvent(DELEGATOR_A, TRANSCODER_A, tokens(100), tokens(2)));

    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("StakeClaimedEvent", id, "delegator", DELEGATOR_A.toHex());
    assert.fieldEquals("StakeClaimedEvent", id, "delegate", TRANSCODER_A.toHex());
    assert.fieldEquals("StakeClaimedEvent", id, "stake", "100");
    assert.fieldEquals("StakeClaimedEvent", id, "fees", "2");
    assert.fieldEquals("StakeClaimedEvent", id, "round", CURRENT_ROUND);
  });

  test("a claim with no stake or fees is recorded as zero", () => {
    stakeClaimed(createStakeClaimedEvent(DELEGATOR_A, TRANSCODER_A, BigInt.zero(), BigInt.zero()));

    assert.fieldEquals("StakeClaimedEvent", eventId(TX_HASH, 1), "stake", "0");
    assert.fieldEquals("StakeClaimedEvent", eventId(TX_HASH, 1), "fees", "0");
  });

  test("two claims in one transaction are recorded separately", () => {
    stakeClaimed(createStakeClaimedEvent(DELEGATOR_A, TRANSCODER_A, tokens(100), tokens(2)));
    stakeClaimed(
      atLogIndex(createStakeClaimedEvent(DELEGATOR_B, TRANSCODER_A, tokens(50), tokens(1)), 2)
    );

    assert.fieldEquals("StakeClaimedEvent", eventId(TX_HASH, 2), "delegator", DELEGATOR_B.toHex());
    assert.entityCount("StakeClaimedEvent", 2);
    assert.entityCount("Transaction", 1);
  });
});
