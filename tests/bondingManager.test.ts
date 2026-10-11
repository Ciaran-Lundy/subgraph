import { Address, BigInt } from "@graphprotocol/graph-ts";
import {
  afterEach,
  assert,
  beforeEach,
  clearStore,
  describe,
  test,
} from "matchstick-as";
import {
  bond,
  transcoderUpdate,
  transferBond,
  unbond,
} from "../src/mappings/bondingManager";
import {
  createOrLoadTranscoder,
  EMPTY_ADDRESS,
  MAXIMUM_VALUE_UINT256,
} from "../utils/helpers";
import {
  createBond,
  createTranscoderUpdate,
  createTransferBond,
  createUnbond,
  mockGetDelegator,
  mockRoundsManager,
  wei,
} from "./helpers";

const transcoder1 = Address.fromString("0xa000000000000000000000000000000000000001");
const transcoder2 = Address.fromString("0xa000000000000000000000000000000000000002");
const delegator = Address.fromString("0xd000000000000000000000000000000000000001");
const receiver = Address.fromString("0xd000000000000000000000000000000000000002");
const ZERO = BigInt.zero();

describe("delegator counts (BDR-44, BDR-46)", () => {
  beforeEach(() => {
    mockRoundsManager();
  });

  afterEach(() => {
    clearStore();
  });

  test("a new bond counts the delegator once", () => {
    mockGetDelegator(transcoder1, ZERO, EMPTY_ADDRESS, wei(10));
    mockGetDelegator(delegator, wei(10), transcoder1, ZERO);
    bond(createBond(transcoder1, EMPTY_ADDRESS, delegator, wei(10), wei(10)));

    assert.fieldEquals("Protocol", "0", "delegatorsCount", "1");
    assert.fieldEquals("Round", "10", "delegatorsCount", "1");
    assert.fieldEquals("Transcoder", transcoder1.toHex(), "delegatorCount", "1");
  });

  test("re-bonding after a full unbond is counted again", () => {
    mockGetDelegator(transcoder1, ZERO, EMPTY_ADDRESS, wei(10));
    mockGetDelegator(delegator, wei(10), transcoder1, ZERO);
    bond(createBond(transcoder1, EMPTY_ADDRESS, delegator, wei(10), wei(10)));

    // Full unbond: bondedAmount drops to zero
    mockGetDelegator(delegator, ZERO, transcoder1, ZERO);
    mockGetDelegator(transcoder1, ZERO, EMPTY_ADDRESS, ZERO);
    unbond(createUnbond(transcoder1, delegator, 0, wei(10)));
    assert.fieldEquals("Protocol", "0", "delegatorsCount", "0");
    assert.fieldEquals("Transcoder", transcoder1.toHex(), "delegatorCount", "0");

    // On-chain the delegate address survives a full unbond, so the new Bond
    // names transcoder1 as oldDelegate. The old heuristic missed this.
    mockGetDelegator(delegator, wei(5), transcoder1, ZERO);
    mockGetDelegator(transcoder1, ZERO, EMPTY_ADDRESS, wei(5));
    bond(createBond(transcoder1, transcoder1, delegator, wei(5), wei(5), 7));

    assert.fieldEquals("Protocol", "0", "delegatorsCount", "1");
    assert.fieldEquals("Transcoder", transcoder1.toHex(), "delegatorCount", "1");
  });

  test("switching delegate moves the per-transcoder count only", () => {
    mockGetDelegator(transcoder1, ZERO, EMPTY_ADDRESS, wei(10));
    mockGetDelegator(delegator, wei(10), transcoder1, ZERO);
    bond(createBond(transcoder1, EMPTY_ADDRESS, delegator, wei(10), wei(10)));

    mockGetDelegator(transcoder1, ZERO, EMPTY_ADDRESS, ZERO);
    mockGetDelegator(transcoder2, ZERO, EMPTY_ADDRESS, wei(11));
    mockGetDelegator(delegator, wei(11), transcoder2, ZERO);
    bond(createBond(transcoder2, transcoder1, delegator, wei(1), wei(11), 7));

    assert.fieldEquals("Protocol", "0", "delegatorsCount", "1");
    assert.fieldEquals("Transcoder", transcoder1.toHex(), "delegatorCount", "0");
    assert.fieldEquals("Transcoder", transcoder2.toHex(), "delegatorCount", "1");
  });

  test("a partial unbond keeps the delegator counted", () => {
    mockGetDelegator(transcoder1, ZERO, EMPTY_ADDRESS, wei(10));
    mockGetDelegator(delegator, wei(10), transcoder1, ZERO);
    bond(createBond(transcoder1, EMPTY_ADDRESS, delegator, wei(10), wei(10)));

    mockGetDelegator(delegator, wei(4), transcoder1, ZERO);
    mockGetDelegator(transcoder1, ZERO, EMPTY_ADDRESS, wei(4));
    unbond(createUnbond(transcoder1, delegator, 0, wei(6)));

    assert.fieldEquals("Protocol", "0", "delegatorsCount", "1");
    assert.fieldEquals("Transcoder", transcoder1.toHex(), "delegatorCount", "1");
  });
});

describe("lastActiveStakeUpdateRound (BDR-10)", () => {
  beforeEach(() => {
    mockRoundsManager();
    mockGetDelegator(delegator, wei(10), transcoder1, ZERO);
    mockGetDelegator(transcoder1, ZERO, EMPTY_ADDRESS, wei(10));
  });

  afterEach(() => {
    clearStore();
  });

  test("moves to currentRound + 1 for an active transcoder", () => {
    let t = createOrLoadTranscoder(transcoder1.toHex(), 0);
    t.activationRound = BigInt.fromI32(5);
    t.lastActiveStakeUpdateRound = BigInt.fromI32(5);
    t.deactivationRound = MAXIMUM_VALUE_UINT256;
    t.save();

    bond(createBond(transcoder1, EMPTY_ADDRESS, delegator, wei(10), wei(10)));

    assert.fieldEquals("Transcoder", transcoder1.toHex(), "lastActiveStakeUpdateRound", "11");
  });

  test("is left alone for a transcoder that is not active", () => {
    bond(createBond(transcoder1, EMPTY_ADDRESS, delegator, wei(10), wei(10)));

    assert.fieldEquals("Transcoder", transcoder1.toHex(), "lastActiveStakeUpdateRound", "0");
  });
});

describe("transferBond (BDR-7)", () => {
  beforeEach(() => {
    mockRoundsManager();
  });

  afterEach(() => {
    clearStore();
  });

  test("a missing old unbonding lock is skipped instead of aborting", () => {
    transferBond(createTransferBond(delegator, receiver, 0, 0, wei(1)));

    assert.entityCount("UnbondingLock", 0);
    assert.entityCount("TransferBondEvent", 1);
  });

  test("the transferred lock keeps the old lock's delegate and withdraw round", () => {
    mockGetDelegator(delegator, wei(9), transcoder1, ZERO);
    mockGetDelegator(transcoder1, ZERO, EMPTY_ADDRESS, wei(9));
    unbond(createUnbond(transcoder1, delegator, 3, wei(1), 25));

    transferBond(createTransferBond(delegator, receiver, 3, 0, wei(1)));

    let newLockId = "0000000000-" + receiver.toHex();
    assert.fieldEquals("UnbondingLock", newLockId, "delegate", transcoder1.toHex());
    assert.fieldEquals("UnbondingLock", newLockId, "withdrawRound", "25");
    assert.notInStore("UnbondingLock", "0000000003-" + delegator.toHex());
  });
});

describe("transcoderUpdate (BDR-39)", () => {
  beforeEach(() => {
    mockRoundsManager();
  });

  afterEach(() => {
    clearStore();
  });

  test("timestamps only move when the value changes", () => {
    transcoderUpdate(createTranscoderUpdate(transcoder1, 100, 200, 1000));
    transcoderUpdate(createTranscoderUpdate(transcoder1, 100, 300, 2000, 9));

    let id = transcoder1.toHex();
    assert.fieldEquals("Transcoder", id, "rewardCutUpdateTimestamp", "1000");
    assert.fieldEquals("Transcoder", id, "feeShareUpdateTimestamp", "2000");
  });
});
