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
import {
  bond,
  earningsClaimed,
  parameterUpdate,
  rebond,
  reward,
  rewardCallerSet,
  transcoderActivated,
  transcoderDeactivated,
  transcoderSlashed,
  transcoderUpdate,
  transferBond,
  unbond,
  withdrawFees,
  withdrawStake,
} from "../src/mappings/bondingManager";
import { Delegator, Pool, Protocol, Transcoder } from "../src/types/schema";
import {
  convertToDecimal,
  createOrLoadPool,
  makePoolId,
  MAXIMUM_VALUE_UINT256,
} from "../utils/helpers";
import {
  ARBITRUM_ONE,
  CURRENT_ROUND,
  DELEGATOR_A,
  DELEGATOR_B,
  eventId,
  L1_BLOCK,
  LAST_ROUND_LENGTH_UPDATE_ROUND,
  MAX_UINT256,
  NEXT_ROUND,
  TIMESTAMP,
  tokens,
  TRANSCODER_A,
  TRANSCODER_B,
  TX_HASH,
  ZERO_ADDRESS,
} from "./helpers/constants";
import {
  atLogIndex,
  atTimestamp,
  createBondEvent,
  createBondingManagerParameterUpdateEvent,
  createEarningsClaimedEvent,
  createRebondEvent,
  createRewardCallerSetEvent,
  createRewardEvent,
  createTranscoderActivatedEvent,
  createTranscoderDeactivatedEvent,
  createTranscoderSlashedEvent,
  createTranscoderUpdateEvent,
  createTransferBondEvent,
  createUnbondEvent,
  createWithdrawFeesEvent,
  createWithdrawStakeEvent,
} from "./helpers/events";
import {
  mockBlockNum,
  mockGetDelegator,
  mockGetDelegatorUnbondingLock,
  mockTranscoderPoolMaxSize,
  mockTranscoderPoolMaxSizeReverts,
  mockUnbondingPeriod,
  mockUnbondingPeriodReverts,
} from "./helpers/mocks";
import {
  decimal,
  seedDelegator,
  seedProtocol,
  seedTranscoder,
  seedUnbondedDelegator,
  seedUnbondingLock,
  unbondingLockId,
} from "./helpers/store";

const ONE = BigInt.fromI32(1);
const LOCK_0 = BigInt.zero();
const LOCK_1 = BigInt.fromI32(1);
const LOCK_3 = BigInt.fromI32(3);
const WITHDRAW_ROUND = 19;

beforeEach(() => {
  dataSourceMock.setNetwork(ARBITRUM_ONE);
  seedProtocol();
  mockBlockNum(L1_BLOCK);
});

afterEach(() => {
  clearStore();
});

function setDelegatorsCount(count: i32): void {
  let protocol = Protocol.load("0")!;
  protocol.delegatorsCount = BigInt.fromI32(count);
  protocol.save();
}

// ---------------------------------------------------------------------------
// bond
// ---------------------------------------------------------------------------

// TRANSCODER_A bonds 100 LPT to itself for the first time.
function bondNewSelfDelegatedTranscoder(): void {
  mockGetDelegator(
    TRANSCODER_A,
    tokens(100),
    BigInt.zero(),
    TRANSCODER_A,
    tokens(100),
    BigInt.fromI32(13)
  );
  bond(
    createBondEvent(TRANSCODER_A, ZERO_ADDRESS, TRANSCODER_A, tokens(100), tokens(100))
  );
}

// DELEGATOR_A bonds 50 LPT to TRANSCODER_A, which already has 100 LPT.
function bondNewDelegatorToExistingTranscoder(): void {
  seedTranscoder(TRANSCODER_A, "Registered", "100");
  mockGetDelegator(
    TRANSCODER_A,
    tokens(100),
    BigInt.zero(),
    TRANSCODER_A,
    tokens(150),
    BigInt.fromI32(11)
  );
  mockGetDelegator(
    DELEGATOR_A,
    tokens(50),
    tokens(2),
    TRANSCODER_A,
    BigInt.zero(),
    BigInt.fromI32(13)
  );
  bond(
    createBondEvent(TRANSCODER_A, ZERO_ADDRESS, DELEGATOR_A, tokens(50), tokens(50))
  );
}

describe("bond", () => {
  test("first-time self-bond registers the transcoder and its delegator", () => {
    bondNewSelfDelegatedTranscoder();

    let transcoder = TRANSCODER_A.toHex();
    assert.fieldEquals("Transcoder", transcoder, "status", "Registered");
    assert.fieldEquals("Transcoder", transcoder, "delegator", transcoder);
    assert.fieldEquals("Transcoder", transcoder, "totalStake", "100");
    assert.fieldEquals("Delegator", transcoder, "delegate", transcoder);
    assert.fieldEquals("Delegator", transcoder, "bondedAmount", "100");
    assert.fieldEquals("Delegator", transcoder, "principal", "100");
    assert.fieldEquals("Delegator", transcoder, "startRound", "13");
    assert.fieldEquals("Delegator", transcoder, "lastClaimRound", CURRENT_ROUND);
    assert.fieldEquals("LivepeerAccount", transcoder, "delegate", transcoder);
    assert.fieldEquals("LivepeerAccount", transcoder, "delegator", transcoder);
    assert.fieldEquals("Round", CURRENT_ROUND, "startBlock", "1200");

    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("BondEvent", id, "round", CURRENT_ROUND);
    assert.fieldEquals("BondEvent", id, "newDelegate", transcoder);
    assert.fieldEquals("BondEvent", id, "oldDelegate", ZERO_ADDRESS.toHex());
    assert.fieldEquals("BondEvent", id, "delegator", transcoder);
    assert.fieldEquals("BondEvent", id, "bondedAmount", "100");
    assert.fieldEquals("BondEvent", id, "additionalAmount", "100");
    assert.fieldEquals("BondEvent", id, "timestamp", TIMESTAMP.toString());
    assert.fieldEquals("Transaction", TX_HASH.toHex(), "timestamp", TIMESTAMP.toString());
  });

  test("bond to an existing transcoder takes its stake from getDelegator", () => {
    bondNewDelegatorToExistingTranscoder();

    let transcoder = TRANSCODER_A.toHex();
    let delegator = DELEGATOR_A.toHex();
    assert.fieldEquals("Transcoder", transcoder, "totalStake", "150");
    assert.fieldEquals("Transcoder", transcoder, "status", "Registered");
    assert.fieldEquals("Delegator", transcoder, "delegatedAmount", "150");
    assert.fieldEquals("Delegator", delegator, "delegate", transcoder);
    assert.fieldEquals("Delegator", delegator, "bondedAmount", "50");
    assert.fieldEquals("Delegator", delegator, "principal", "50");
    assert.fieldEquals("Delegator", delegator, "fees", "2");
    assert.fieldEquals("Round", CURRENT_ROUND, "movedStake", "0");
    assert.fieldEquals("Round", CURRENT_ROUND, "newStake", "0");
  });

  test("consecutive bonds in one transaction accumulate principal", () => {
    seedTranscoder(TRANSCODER_A, "Registered", "100");
    mockGetDelegator(
      TRANSCODER_A,
      tokens(100),
      BigInt.zero(),
      TRANSCODER_A,
      tokens(175),
      BigInt.fromI32(11)
    );
    mockGetDelegator(
      DELEGATOR_A,
      tokens(75),
      BigInt.zero(),
      TRANSCODER_A,
      BigInt.zero(),
      BigInt.fromI32(13)
    );

    bond(
      createBondEvent(TRANSCODER_A, ZERO_ADDRESS, DELEGATOR_A, tokens(50), tokens(50))
    );
    bond(
      atLogIndex(
        createBondEvent(TRANSCODER_A, TRANSCODER_A, DELEGATOR_A, tokens(25), tokens(75)),
        2
      )
    );

    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "principal", "75");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "bondedAmount", "75");
    assert.fieldEquals("BondEvent", eventId(TX_HASH, 1), "additionalAmount", "50");
    assert.fieldEquals("BondEvent", eventId(TX_HASH, 2), "additionalAmount", "25");
    assert.entityCount("BondEvent", 2);
    assert.entityCount("Transaction", 1);
    // Same delegate both times, so nothing counts as moved stake.
    assert.fieldEquals("Round", CURRENT_ROUND, "movedStake", "0");
  });

  test("switching delegates with no new stake moves the stake to the new transcoder", () => {
    seedTranscoder(TRANSCODER_A, "Registered", "150");
    seedTranscoder(TRANSCODER_B, "Registered", "200");
    seedDelegator(DELEGATOR_A, TRANSCODER_A, "50");
    mockGetDelegator(
      TRANSCODER_B,
      tokens(200),
      BigInt.zero(),
      TRANSCODER_B,
      tokens(250),
      BigInt.fromI32(11)
    );
    mockGetDelegator(
      TRANSCODER_A,
      tokens(100),
      BigInt.zero(),
      TRANSCODER_A,
      tokens(100),
      BigInt.fromI32(11)
    );
    mockGetDelegator(
      DELEGATOR_A,
      tokens(50),
      BigInt.zero(),
      TRANSCODER_B,
      BigInt.zero(),
      BigInt.fromI32(13)
    );

    bond(
      createBondEvent(TRANSCODER_B, TRANSCODER_A, DELEGATOR_A, BigInt.zero(), tokens(50))
    );

    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "totalStake", "100");
    assert.fieldEquals("Delegator", TRANSCODER_A.toHex(), "delegatedAmount", "100");
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "status", "Registered");
    assert.fieldEquals("Transcoder", TRANSCODER_B.toHex(), "totalStake", "250");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "delegate", TRANSCODER_B.toHex());
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "principal", "50");
    assert.fieldEquals("Round", CURRENT_ROUND, "movedStake", "50");
    assert.fieldEquals("Round", CURRENT_ROUND, "newStake", "0");
  });

  test("switching delegates while adding stake splits moved and new stake", () => {
    seedTranscoder(TRANSCODER_A, "Registered", "150");
    seedTranscoder(TRANSCODER_B, "Registered", "200");
    seedDelegator(DELEGATOR_A, TRANSCODER_A, "50");
    mockGetDelegator(
      TRANSCODER_B,
      tokens(200),
      BigInt.zero(),
      TRANSCODER_B,
      tokens(280),
      BigInt.fromI32(11)
    );
    mockGetDelegator(
      TRANSCODER_A,
      tokens(100),
      BigInt.zero(),
      TRANSCODER_A,
      tokens(100),
      BigInt.fromI32(11)
    );
    mockGetDelegator(
      DELEGATOR_A,
      tokens(80),
      BigInt.zero(),
      TRANSCODER_B,
      BigInt.zero(),
      BigInt.fromI32(13)
    );

    bond(
      createBondEvent(TRANSCODER_B, TRANSCODER_A, DELEGATOR_A, tokens(30), tokens(80))
    );

    assert.fieldEquals("Round", CURRENT_ROUND, "movedStake", "50");
    assert.fieldEquals("Round", CURRENT_ROUND, "newStake", "30");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "principal", "80");
    assert.fieldEquals("Transcoder", TRANSCODER_B.toHex(), "totalStake", "280");
  });

  test("self-delegated transcoder switching away is deregistered", () => {
    seedTranscoder(TRANSCODER_A, "Registered", "100");
    let self = Transcoder.load(TRANSCODER_A.toHex())!;
    self.delegator = TRANSCODER_A.toHex();
    self.save();
    seedDelegator(TRANSCODER_A, TRANSCODER_A, "100");
    seedTranscoder(TRANSCODER_B, "Registered", "200");
    mockGetDelegator(
      TRANSCODER_B,
      tokens(200),
      BigInt.zero(),
      TRANSCODER_B,
      tokens(300),
      BigInt.fromI32(11)
    );
    mockGetDelegator(
      TRANSCODER_A,
      tokens(100),
      BigInt.zero(),
      TRANSCODER_B,
      BigInt.zero(),
      BigInt.fromI32(13)
    );

    bond(
      createBondEvent(TRANSCODER_B, TRANSCODER_A, TRANSCODER_A, BigInt.zero(), tokens(100))
    );

    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "status", "NotRegistered");
    assert.assertNull(Transcoder.load(TRANSCODER_A.toHex())!.delegator);
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "totalStake", "0");
    assert.fieldEquals("Transcoder", TRANSCODER_B.toHex(), "totalStake", "300");
    assert.fieldEquals("Delegator", TRANSCODER_A.toHex(), "delegate", TRANSCODER_B.toHex());
    assert.fieldEquals("Round", CURRENT_ROUND, "movedStake", "100");
  });

  test("bond of the largest uint256 amount stores it at BigDecimal precision", () => {
    mockGetDelegator(
      TRANSCODER_A,
      MAX_UINT256,
      BigInt.zero(),
      TRANSCODER_A,
      MAX_UINT256,
      BigInt.fromI32(13)
    );

    bond(
      createBondEvent(TRANSCODER_A, ZERO_ADDRESS, TRANSCODER_A, MAX_UINT256, MAX_UINT256)
    );

    let expected = convertToDecimal(MAX_UINT256).toString();
    assert.fieldEquals("Delegator", TRANSCODER_A.toHex(), "bondedAmount", expected);
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "totalStake", expected);
  });

  // BDR-44 known bug: set shouldFail to false when fixed
  test(
    "BDR-44: first bond from the zero-address delegate counts a new delegator",
    () => {
      setDelegatorsCount(5);
      bondNewSelfDelegatedTranscoder();

      assert.fieldEquals("Protocol", "0", "delegatorsCount", "6");
      assert.fieldEquals("Round", CURRENT_ROUND, "delegatorsCount", "1");
    },
    true
  );

  // BDR-10 known bug: set shouldFail to false when fixed
  test(
    "BDR-10: bond sets the delegate's lastActiveStakeUpdateRound to currentRound + 1",
    () => {
      bondNewDelegatorToExistingTranscoder();

      assert.fieldEquals(
        "Transcoder",
        TRANSCODER_A.toHex(),
        "lastActiveStakeUpdateRound",
        NEXT_ROUND
      );
    },
    true
  );
});

// ---------------------------------------------------------------------------
// transferBond
// ---------------------------------------------------------------------------

function transferLock0FromDelegatorAToDelegatorB(): void {
  transferBond(
    createTransferBondEvent(DELEGATOR_A, DELEGATOR_B, LOCK_0, LOCK_3, tokens(40))
  );
}

describe("transferBond", () => {
  test("moves an existing unbonding lock to the new delegator", () => {
    seedUnbondingLock(DELEGATOR_A, 0, DELEGATOR_A, TRANSCODER_A, "40", WITHDRAW_ROUND);

    transferLock0FromDelegatorAToDelegatorB();

    let newLock = unbondingLockId(DELEGATOR_B, 3);
    assert.fieldEquals("UnbondingLock", newLock, "unbondingLockId", "3");
    assert.fieldEquals("UnbondingLock", newLock, "delegator", DELEGATOR_B.toHex());
    assert.fieldEquals("UnbondingLock", newLock, "sender", DELEGATOR_A.toHex());
    assert.fieldEquals("UnbondingLock", newLock, "delegate", TRANSCODER_A.toHex());
    assert.fieldEquals("UnbondingLock", newLock, "withdrawRound", WITHDRAW_ROUND.toString());
    assert.fieldEquals("UnbondingLock", newLock, "amount", "40");
    assert.notInStore("UnbondingLock", unbondingLockId(DELEGATOR_A, 0));
    assert.fieldEquals("Delegator", DELEGATOR_B.toHex(), "principal", "40");

    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("TransferBondEvent", id, "oldDelegator", DELEGATOR_A.toHex());
    assert.fieldEquals("TransferBondEvent", id, "newDelegator", DELEGATOR_B.toHex());
    assert.fieldEquals("TransferBondEvent", id, "oldUnbondingLockId", "0");
    assert.fieldEquals("TransferBondEvent", id, "newUnbondingLockId", "3");
    assert.fieldEquals("TransferBondEvent", id, "amount", "40");
    assert.fieldEquals("TransferBondEvent", id, "round", CURRENT_ROUND);
  });

  test("overwrites a stale lock already stored under the new id", () => {
    seedUnbondingLock(DELEGATOR_A, 0, DELEGATOR_A, TRANSCODER_A, "40", WITHDRAW_ROUND);
    seedUnbondingLock(DELEGATOR_B, 3, DELEGATOR_B, TRANSCODER_B, "999", 99);

    transferLock0FromDelegatorAToDelegatorB();

    let newLock = unbondingLockId(DELEGATOR_B, 3);
    assert.fieldEquals("UnbondingLock", newLock, "sender", DELEGATOR_A.toHex());
    assert.fieldEquals("UnbondingLock", newLock, "delegate", TRANSCODER_A.toHex());
    assert.fieldEquals("UnbondingLock", newLock, "amount", "40");
    assert.fieldEquals("UnbondingLock", newLock, "withdrawRound", WITHDRAW_ROUND.toString());
  });

  test("adds the transferred amount to an existing delegator's principal", () => {
    seedDelegator(DELEGATOR_B, TRANSCODER_B, "60");
    seedUnbondingLock(DELEGATOR_A, 0, DELEGATOR_A, TRANSCODER_A, "40", WITHDRAW_ROUND);

    transferLock0FromDelegatorAToDelegatorB();

    assert.fieldEquals("Delegator", DELEGATOR_B.toHex(), "principal", "100");
    assert.fieldEquals("Delegator", DELEGATOR_B.toHex(), "delegate", TRANSCODER_B.toHex());
  });

  // BDR-7 known bug: set shouldFail to false when fixed
  // Today the handler aborts reading `delegate` from a placeholder lock. Both
  // of v4's fixes (recover the lock via eth_calls, or log and return early)
  // complete without aborting and leave no lock under the old id; the calls
  // the first fix needs are mocked so either fix passes this test. Unlike
  // graph-node, Matchstick aborts store.remove() of an entity that is not
  // stored, so the fix must only remove the old lock when it was loaded.
  test(
    "BDR-7: a transfer whose old unbonding lock is not stored does not abort",
    () => {
      mockGetDelegatorUnbondingLock(
        DELEGATOR_A,
        LOCK_0,
        tokens(40),
        BigInt.fromI32(WITHDRAW_ROUND)
      );
      mockGetDelegator(
        DELEGATOR_A,
        BigInt.zero(),
        BigInt.zero(),
        TRANSCODER_A,
        BigInt.zero(),
        BigInt.fromI32(11)
      );

      transferLock0FromDelegatorAToDelegatorB();

      assert.notInStore("UnbondingLock", unbondingLockId(DELEGATOR_A, 0));
    },
    true
  );
});

// ---------------------------------------------------------------------------
// unbond
// ---------------------------------------------------------------------------

// DELEGATOR_A, bonded 50 LPT to TRANSCODER_A (150 LPT total), unbonds 20.
function unbondPartOfDelegatorAStake(): void {
  seedTranscoder(TRANSCODER_A, "Registered", "150");
  seedDelegator(DELEGATOR_A, TRANSCODER_A, "50");
  mockGetDelegator(
    TRANSCODER_A,
    tokens(100),
    BigInt.zero(),
    TRANSCODER_A,
    tokens(130),
    BigInt.fromI32(11)
  );
  mockGetDelegator(
    DELEGATOR_A,
    tokens(30),
    tokens(1),
    TRANSCODER_A,
    BigInt.zero(),
    BigInt.fromI32(11)
  );
  unbond(
    createUnbondEvent(
      TRANSCODER_A,
      DELEGATOR_A,
      LOCK_0,
      tokens(20),
      BigInt.fromI32(WITHDRAW_ROUND)
    )
  );
}

// DELEGATOR_A unbonds all 50 LPT it had bonded to TRANSCODER_A.
function unbondAllOfDelegatorAStake(): void {
  seedTranscoder(TRANSCODER_A, "Registered", "150");
  seedDelegator(DELEGATOR_A, TRANSCODER_A, "50");
  mockGetDelegator(
    TRANSCODER_A,
    tokens(100),
    BigInt.zero(),
    TRANSCODER_A,
    tokens(100),
    BigInt.fromI32(11)
  );
  mockGetDelegator(
    DELEGATOR_A,
    BigInt.zero(),
    BigInt.zero(),
    ZERO_ADDRESS,
    BigInt.zero(),
    BigInt.zero()
  );
  unbond(
    createUnbondEvent(
      TRANSCODER_A,
      DELEGATOR_A,
      LOCK_0,
      tokens(50),
      BigInt.fromI32(WITHDRAW_ROUND)
    )
  );
}

describe("unbond", () => {
  test("partial unbond creates a lock and keeps the delegator bonded", () => {
    setDelegatorsCount(5);
    unbondPartOfDelegatorAStake();

    let lock = unbondingLockId(DELEGATOR_A, 0);
    assert.fieldEquals("UnbondingLock", lock, "delegator", DELEGATOR_A.toHex());
    assert.fieldEquals("UnbondingLock", lock, "sender", DELEGATOR_A.toHex());
    assert.fieldEquals("UnbondingLock", lock, "delegate", TRANSCODER_A.toHex());
    assert.fieldEquals("UnbondingLock", lock, "amount", "20");
    assert.fieldEquals("UnbondingLock", lock, "withdrawRound", WITHDRAW_ROUND.toString());

    let delegator = DELEGATOR_A.toHex();
    assert.fieldEquals("Delegator", delegator, "bondedAmount", "30");
    assert.fieldEquals("Delegator", delegator, "unbonded", "20");
    assert.fieldEquals("Delegator", delegator, "fees", "1");
    assert.fieldEquals("Delegator", delegator, "delegate", TRANSCODER_A.toHex());
    assert.fieldEquals("Delegator", delegator, "lastClaimRound", CURRENT_ROUND);
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "totalStake", "130");
    assert.fieldEquals("Delegator", TRANSCODER_A.toHex(), "delegatedAmount", "130");
    assert.fieldEquals("Protocol", "0", "delegatorsCount", "5");

    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("UnbondEvent", id, "amount", "20");
    assert.fieldEquals("UnbondEvent", id, "withdrawRound", WITHDRAW_ROUND.toString());
    assert.fieldEquals("UnbondEvent", id, "unbondingLockId", "0");
    assert.fieldEquals("UnbondEvent", id, "delegate", TRANSCODER_A.toHex());
    assert.fieldEquals("UnbondEvent", id, "delegator", delegator);
  });

  test("full unbond clears the delegate and decrements delegatorsCount", () => {
    setDelegatorsCount(5);
    unbondAllOfDelegatorAStake();

    assert.assertNull(Delegator.load(DELEGATOR_A.toHex())!.delegate);
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "bondedAmount", "0");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "unbonded", "50");
    assert.fieldEquals("Protocol", "0", "delegatorsCount", "4");
    // A delegator leaving a transcoder doesn't deregister the transcoder.
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "status", "Registered");
  });

  test("full self-unbond deregisters the transcoder", () => {
    seedTranscoder(TRANSCODER_A, "Registered", "100");
    let self = Transcoder.load(TRANSCODER_A.toHex())!;
    self.delegator = TRANSCODER_A.toHex();
    self.save();
    seedDelegator(TRANSCODER_A, TRANSCODER_A, "100");
    mockGetDelegator(
      TRANSCODER_A,
      BigInt.zero(),
      BigInt.zero(),
      ZERO_ADDRESS,
      BigInt.zero(),
      BigInt.zero()
    );

    unbond(
      createUnbondEvent(
        TRANSCODER_A,
        TRANSCODER_A,
        LOCK_0,
        tokens(100),
        BigInt.fromI32(WITHDRAW_ROUND)
      )
    );

    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "status", "NotRegistered");
    assert.assertNull(Transcoder.load(TRANSCODER_A.toHex())!.delegator);
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "totalStake", "0");
    assert.assertNull(Delegator.load(TRANSCODER_A.toHex())!.delegate);
  });

  test("consecutive unbonds in one transaction accumulate unbonded", () => {
    seedTranscoder(TRANSCODER_A, "Registered", "150");
    seedDelegator(DELEGATOR_A, TRANSCODER_A, "50");
    mockGetDelegator(
      TRANSCODER_A,
      tokens(100),
      BigInt.zero(),
      TRANSCODER_A,
      tokens(115),
      BigInt.fromI32(11)
    );
    mockGetDelegator(
      DELEGATOR_A,
      tokens(15),
      BigInt.zero(),
      TRANSCODER_A,
      BigInt.zero(),
      BigInt.fromI32(11)
    );

    unbond(
      createUnbondEvent(TRANSCODER_A, DELEGATOR_A, LOCK_0, tokens(20), BigInt.fromI32(19))
    );
    unbond(
      atLogIndex(
        createUnbondEvent(TRANSCODER_A, DELEGATOR_A, LOCK_1, tokens(15), BigInt.fromI32(19)),
        2
      )
    );

    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "unbonded", "35");
    assert.fieldEquals("UnbondingLock", unbondingLockId(DELEGATOR_A, 0), "amount", "20");
    assert.fieldEquals("UnbondingLock", unbondingLockId(DELEGATOR_A, 1), "amount", "15");
    assert.entityCount("UnbondEvent", 2);
    assert.entityCount("Transaction", 1);
  });

  // BDR-44 known bug: set shouldFail to false when fixed
  test(
    "BDR-44: a full unbond never drives delegatorsCount below zero",
    () => {
      setDelegatorsCount(0);
      unbondAllOfDelegatorAStake();

      assert.fieldEquals("Protocol", "0", "delegatorsCount", "0");
    },
    true
  );

  // BDR-10 known bug: set shouldFail to false when fixed
  test(
    "BDR-10: unbond sets the delegate's lastActiveStakeUpdateRound to currentRound + 1",
    () => {
      unbondPartOfDelegatorAStake();

      assert.fieldEquals(
        "Transcoder",
        TRANSCODER_A.toHex(),
        "lastActiveStakeUpdateRound",
        NEXT_ROUND
      );
    },
    true
  );
});

// ---------------------------------------------------------------------------
// rebond
// ---------------------------------------------------------------------------

// DELEGATOR_A (30 LPT bonded, 20 unbonded) rebonds its own 20 LPT lock.
function rebondDelegatorAOwnLock(): void {
  seedTranscoder(TRANSCODER_A, "Registered", "130");
  seedDelegator(DELEGATOR_A, TRANSCODER_A, "30");
  let delegator = Delegator.load(DELEGATOR_A.toHex())!;
  delegator.unbonded = decimal("20");
  delegator.save();
  seedUnbondingLock(DELEGATOR_A, 0, DELEGATOR_A, TRANSCODER_A, "20", WITHDRAW_ROUND);
  mockRebondCalls();
  rebond(createRebondEvent(TRANSCODER_A, DELEGATOR_A, LOCK_0, tokens(20)));
}

function mockRebondCalls(): void {
  mockGetDelegator(
    TRANSCODER_A,
    tokens(100),
    BigInt.zero(),
    TRANSCODER_A,
    tokens(150),
    BigInt.fromI32(11)
  );
  mockGetDelegator(
    DELEGATOR_A,
    tokens(50),
    BigInt.zero(),
    TRANSCODER_A,
    BigInt.zero(),
    BigInt.fromI32(13)
  );
}

describe("rebond", () => {
  test("rebonding the delegator's own lock reduces unbonded and removes the lock", () => {
    setDelegatorsCount(5);
    rebondDelegatorAOwnLock();

    let delegator = DELEGATOR_A.toHex();
    assert.fieldEquals("Delegator", delegator, "unbonded", "0");
    assert.fieldEquals("Delegator", delegator, "bondedAmount", "50");
    assert.fieldEquals("Delegator", delegator, "delegate", TRANSCODER_A.toHex());
    assert.fieldEquals("Delegator", delegator, "startRound", "13");
    assert.fieldEquals("Delegator", delegator, "lastClaimRound", CURRENT_ROUND);
    assert.notInStore("UnbondingLock", unbondingLockId(DELEGATOR_A, 0));
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "totalStake", "150");
    assert.fieldEquals("Protocol", "0", "delegatorsCount", "5");

    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("RebondEvent", id, "delegator", delegator);
    assert.fieldEquals("RebondEvent", id, "delegate", TRANSCODER_A.toHex());
    assert.fieldEquals("RebondEvent", id, "amount", "20");
    assert.fieldEquals("RebondEvent", id, "unbondingLockId", "0");
  });

  test("rebonding from fully unbonded re-registers a self-delegated transcoder", () => {
    setDelegatorsCount(5);
    seedTranscoder(TRANSCODER_A, "NotRegistered", "0");
    seedUnbondedDelegator(TRANSCODER_A, "100");
    seedUnbondingLock(TRANSCODER_A, 0, TRANSCODER_A, TRANSCODER_A, "100", WITHDRAW_ROUND);
    mockGetDelegator(
      TRANSCODER_A,
      tokens(100),
      BigInt.zero(),
      TRANSCODER_A,
      tokens(100),
      BigInt.fromI32(13)
    );

    rebond(createRebondEvent(TRANSCODER_A, TRANSCODER_A, LOCK_0, tokens(100)));

    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "status", "Registered");
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "delegator", TRANSCODER_A.toHex());
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "totalStake", "100");
    assert.fieldEquals("Delegator", TRANSCODER_A.toHex(), "delegate", TRANSCODER_A.toHex());
    assert.fieldEquals("Delegator", TRANSCODER_A.toHex(), "unbonded", "0");
    assert.fieldEquals("Protocol", "0", "delegatorsCount", "6");
  });

  test("rebonding a lock received via transferBond leaves unbonded untouched", () => {
    seedTranscoder(TRANSCODER_A, "Registered", "130");
    seedDelegator(DELEGATOR_A, TRANSCODER_A, "30");
    let delegator = Delegator.load(DELEGATOR_A.toHex())!;
    delegator.unbonded = decimal("20");
    delegator.save();
    seedUnbondingLock(DELEGATOR_A, 0, DELEGATOR_B, TRANSCODER_A, "20", WITHDRAW_ROUND);
    mockRebondCalls();

    rebond(createRebondEvent(TRANSCODER_A, DELEGATOR_A, LOCK_0, tokens(20)));

    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "unbonded", "20");
    assert.notInStore("UnbondingLock", unbondingLockId(DELEGATOR_A, 0));
  });

  test("rebond with no stored lock leaves unbonded untouched", () => {
    seedTranscoder(TRANSCODER_A, "Registered", "130");
    seedDelegator(DELEGATOR_A, TRANSCODER_A, "30");
    let delegator = Delegator.load(DELEGATOR_A.toHex())!;
    delegator.unbonded = decimal("20");
    delegator.save();
    mockRebondCalls();

    rebond(createRebondEvent(TRANSCODER_A, DELEGATOR_A, LOCK_0, tokens(20)));

    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "unbonded", "20");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "bondedAmount", "50");
    assert.entityCount("RebondEvent", 1);
  });

  // BDR-10 known bug: set shouldFail to false when fixed
  test(
    "BDR-10: rebond sets the delegate's lastActiveStakeUpdateRound to currentRound + 1",
    () => {
      rebondDelegatorAOwnLock();

      assert.fieldEquals(
        "Transcoder",
        TRANSCODER_A.toHex(),
        "lastActiveStakeUpdateRound",
        NEXT_ROUND
      );
    },
    true
  );
});

// ---------------------------------------------------------------------------
// withdrawStake and withdrawFees
// ---------------------------------------------------------------------------

describe("withdrawStake", () => {
  test("removes the withdrawn lock and records the event", () => {
    seedUnbondingLock(DELEGATOR_A, 0, DELEGATOR_A, TRANSCODER_A, "20", WITHDRAW_ROUND);

    withdrawStake(
      createWithdrawStakeEvent(DELEGATOR_A, LOCK_0, tokens(20), BigInt.fromI32(WITHDRAW_ROUND))
    );

    assert.notInStore("UnbondingLock", unbondingLockId(DELEGATOR_A, 0));
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("WithdrawStakeEvent", id, "amount", "20");
    assert.fieldEquals("WithdrawStakeEvent", id, "unbondingLockId", "0");
    assert.fieldEquals("WithdrawStakeEvent", id, "delegator", DELEGATOR_A.toHex());
    assert.fieldEquals("WithdrawStakeEvent", id, "round", CURRENT_ROUND);
  });

  test("withdrawing one lock leaves the delegator's other locks in place", () => {
    seedUnbondingLock(DELEGATOR_A, 0, DELEGATOR_A, TRANSCODER_A, "20", WITHDRAW_ROUND);
    seedUnbondingLock(DELEGATOR_A, 1, DELEGATOR_A, TRANSCODER_A, "15", WITHDRAW_ROUND);

    withdrawStake(
      createWithdrawStakeEvent(DELEGATOR_A, LOCK_0, tokens(20), BigInt.fromI32(WITHDRAW_ROUND))
    );

    assert.notInStore("UnbondingLock", unbondingLockId(DELEGATOR_A, 0));
    assert.fieldEquals("UnbondingLock", unbondingLockId(DELEGATOR_A, 1), "amount", "15");
  });
});

function mockDelegatorAAfterFeeWithdrawal(): void {
  mockGetDelegator(
    DELEGATOR_A,
    tokens(50),
    BigInt.zero(),
    TRANSCODER_A,
    BigInt.zero(),
    BigInt.fromI32(11)
  );
}

describe("withdrawFees", () => {
  test("refreshes the delegator from getDelegator and adds to withdrawnFees", () => {
    seedDelegator(DELEGATOR_A, TRANSCODER_A, "40");
    mockDelegatorAAfterFeeWithdrawal();

    withdrawFees(createWithdrawFeesEvent(DELEGATOR_A, DELEGATOR_B, tokens(3)));

    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "bondedAmount", "50");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "fees", "0");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "withdrawnFees", "3");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "lastClaimRound", CURRENT_ROUND);
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("WithdrawFeesEvent", id, "recipient", DELEGATOR_B.toHex());
    assert.fieldEquals("WithdrawFeesEvent", id, "delegator", DELEGATOR_A.toHex());
    assert.fieldEquals("WithdrawFeesEvent", id, "amount", "3");
  });

  test("consecutive withdrawals accumulate withdrawnFees", () => {
    seedDelegator(DELEGATOR_A, TRANSCODER_A, "50");
    mockDelegatorAAfterFeeWithdrawal();

    withdrawFees(createWithdrawFeesEvent(DELEGATOR_A, DELEGATOR_A, tokens(3)));
    withdrawFees(atLogIndex(createWithdrawFeesEvent(DELEGATOR_A, DELEGATOR_A, tokens(4)), 2));

    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "withdrawnFees", "7");
    assert.entityCount("WithdrawFeesEvent", 2);
  });

  test("a zero-amount withdrawal leaves withdrawnFees at zero", () => {
    seedDelegator(DELEGATOR_A, TRANSCODER_A, "50");
    mockDelegatorAAfterFeeWithdrawal();

    withdrawFees(createWithdrawFeesEvent(DELEGATOR_A, DELEGATOR_A, BigInt.zero()));

    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "withdrawnFees", "0");
    assert.fieldEquals("WithdrawFeesEvent", eventId(TX_HASH, 1), "amount", "0");
  });
});

// ---------------------------------------------------------------------------
// parameterUpdate
// ---------------------------------------------------------------------------

describe("parameterUpdate", () => {
  test("unbondingPeriod is read from the contract", () => {
    mockUnbondingPeriod(BigInt.fromI32(7));
    mockTranscoderPoolMaxSizeReverts();

    parameterUpdate(createBondingManagerParameterUpdateEvent("unbondingPeriod"));

    assert.fieldEquals("Protocol", "0", "unbondingPeriod", "7");
    assert.fieldEquals("Protocol", "0", "numActiveTranscoders", "0");
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("ParameterUpdateEvent", id, "param", "unbondingPeriod");
    assert.fieldEquals("ParameterUpdateEvent", id, "round", LAST_ROUND_LENGTH_UPDATE_ROUND);
  });

  test("numActiveTranscoders is read from getTranscoderPoolMaxSize", () => {
    mockTranscoderPoolMaxSize(BigInt.fromI32(100));
    mockUnbondingPeriodReverts();

    parameterUpdate(createBondingManagerParameterUpdateEvent("numActiveTranscoders"));

    assert.fieldEquals("Protocol", "0", "numActiveTranscoders", "100");
    assert.fieldEquals("Protocol", "0", "unbondingPeriod", "0");
  });

  test("an unrelated parameter makes no eth_call and changes no protocol field", () => {
    mockUnbondingPeriodReverts();
    mockTranscoderPoolMaxSizeReverts();

    parameterUpdate(createBondingManagerParameterUpdateEvent("somethingElse"));

    assert.fieldEquals("Protocol", "0", "unbondingPeriod", "0");
    assert.fieldEquals("Protocol", "0", "numActiveTranscoders", "0");
    assert.fieldEquals("ParameterUpdateEvent", eventId(TX_HASH, 1), "param", "somethingElse");
  });
});

// ---------------------------------------------------------------------------
// reward
// ---------------------------------------------------------------------------

function seedRewardingTranscoder(): void {
  seedTranscoder(TRANSCODER_A, "Registered", "1000");
  let transcoder = Transcoder.load(TRANSCODER_A.toHex())!;
  transcoder.rewardCut = BigInt.fromI32(500000);
  transcoder.feeShare = BigInt.fromI32(100000);
  transcoder.save();
  let self = seedDelegator(TRANSCODER_A, TRANSCODER_A, "1000");
  self.delegatedAmount = decimal("1000");
  self.save();
}

describe("reward", () => {
  test("first reward of the round creates the pool from the pre-reward stake", () => {
    seedRewardingTranscoder();

    reward(createRewardEvent(TRANSCODER_A, tokens(10)));

    let pool = makePoolId(TRANSCODER_A.toHex(), CURRENT_ROUND);
    assert.fieldEquals("Pool", pool, "round", CURRENT_ROUND);
    assert.fieldEquals("Pool", pool, "delegate", TRANSCODER_A.toHex());
    assert.fieldEquals("Pool", pool, "fees", "0");
    assert.fieldEquals("Pool", pool, "rewardTokens", "10");
    assert.fieldEquals("Pool", pool, "totalStake", "1000");
    assert.fieldEquals("Pool", pool, "rewardCut", "500000");
    assert.fieldEquals("Pool", pool, "feeShare", "100000");
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "totalStake", "1010");
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "lastRewardRound", CURRENT_ROUND);
    assert.fieldEquals("Delegator", TRANSCODER_A.toHex(), "delegatedAmount", "1010");
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("RewardEvent", id, "rewardTokens", "10");
    assert.fieldEquals("RewardEvent", id, "delegate", TRANSCODER_A.toHex());
    assert.fieldEquals("RewardEvent", id, "round", CURRENT_ROUND);
  });

  test("reward into a pool created earlier in the round keeps its fees", () => {
    seedRewardingTranscoder();
    let pool = createOrLoadPool(CURRENT_ROUND, TRANSCODER_A.toHex());
    pool.fees = decimal("3");
    pool.save();

    reward(createRewardEvent(TRANSCODER_A, tokens(10)));

    assert.fieldEquals("Pool", pool.id, "fees", "3");
    assert.fieldEquals("Pool", pool.id, "rewardTokens", "10");
  });

  test("a zero reward leaves the stake unchanged but records the pool", () => {
    seedRewardingTranscoder();

    reward(createRewardEvent(TRANSCODER_A, BigInt.zero()));

    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "totalStake", "1000");
    let pool = makePoolId(TRANSCODER_A.toHex(), CURRENT_ROUND);
    assert.fieldEquals("Pool", pool, "rewardTokens", "0");
    assert.assertNotNull(Pool.load(pool));
  });

  // BDR-10 known bug: set shouldFail to false when fixed
  test(
    "BDR-10: reward sets lastActiveStakeUpdateRound to currentRound + 1",
    () => {
      seedRewardingTranscoder();

      reward(createRewardEvent(TRANSCODER_A, tokens(10)));

      assert.fieldEquals(
        "Transcoder",
        TRANSCODER_A.toHex(),
        "lastActiveStakeUpdateRound",
        NEXT_ROUND
      );
    },
    true
  );
});

// ---------------------------------------------------------------------------
// transcoderSlashed (handler exists but is not registered; see BDR-3)
// ---------------------------------------------------------------------------

describe("transcoderSlashed", () => {
  // BDR-4 known bug: set shouldFail to false when fixed
  // There is no passing guard for this scenario: today the handler always
  // aborts when it saves the event entity without its non-nullable fields.
  test(
    "BDR-4: slashing records finder, penalty and finderReward from the event",
    () => {
      seedTranscoder(TRANSCODER_A, "Registered", "100");
      mockGetDelegator(
        TRANSCODER_A,
        tokens(90),
        BigInt.zero(),
        TRANSCODER_A,
        tokens(90),
        BigInt.fromI32(11)
      );

      transcoderSlashed(
        createTranscoderSlashedEvent(TRANSCODER_A, DELEGATOR_B, tokens(10), tokens(1))
      );

      let id = eventId(TX_HASH, 1);
      assert.fieldEquals("TranscoderSlashedEvent", id, "finder", DELEGATOR_B.toHex());
      assert.fieldEquals("TranscoderSlashedEvent", id, "penalty", "10");
      assert.fieldEquals(
        "TranscoderSlashedEvent",
        id,
        "finderReward",
        tokens(1).toString()
      );
      assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "totalStake", "90");
    },
    true
  );
});

// ---------------------------------------------------------------------------
// transcoderUpdate
// ---------------------------------------------------------------------------

const REWARD_CUT = BigInt.fromI32(50000);
const FEE_SHARE = BigInt.fromI32(900000);
const EARLIER_TIMESTAMP = 1000;
const LATER_TIMESTAMP = TIMESTAMP + 3600;

function seedTranscoderWithCutAndShare(rewardCut: BigInt, feeShare: BigInt): void {
  seedTranscoder(TRANSCODER_A, "Registered", "100");
  let transcoder = Transcoder.load(TRANSCODER_A.toHex())!;
  transcoder.rewardCut = rewardCut;
  transcoder.feeShare = feeShare;
  transcoder.rewardCutUpdateTimestamp = EARLIER_TIMESTAMP;
  transcoder.feeShareUpdateTimestamp = EARLIER_TIMESTAMP;
  transcoder.save();
}

describe("transcoderUpdate", () => {
  test("first update of a new transcoder stores the values and timestamps", () => {
    transcoderUpdate(createTranscoderUpdateEvent(TRANSCODER_A, REWARD_CUT, FEE_SHARE));

    let transcoder = TRANSCODER_A.toHex();
    assert.fieldEquals("Transcoder", transcoder, "rewardCut", "50000");
    assert.fieldEquals("Transcoder", transcoder, "feeShare", "900000");
    assert.fieldEquals("Transcoder", transcoder, "rewardCutUpdateTimestamp", TIMESTAMP.toString());
    assert.fieldEquals("Transcoder", transcoder, "feeShareUpdateTimestamp", TIMESTAMP.toString());
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("TranscoderUpdateEvent", id, "rewardCut", "50000");
    assert.fieldEquals("TranscoderUpdateEvent", id, "feeShare", "900000");
    assert.fieldEquals("TranscoderUpdateEvent", id, "delegate", transcoder);
  });

  test("changing both values bumps both timestamps", () => {
    seedTranscoderWithCutAndShare(BigInt.fromI32(1), BigInt.fromI32(2));

    transcoderUpdate(
      atTimestamp(createTranscoderUpdateEvent(TRANSCODER_A, REWARD_CUT, FEE_SHARE), LATER_TIMESTAMP)
    );

    let transcoder = TRANSCODER_A.toHex();
    assert.fieldEquals("Transcoder", transcoder, "rewardCut", "50000");
    assert.fieldEquals("Transcoder", transcoder, "feeShare", "900000");
    assert.fieldEquals("Transcoder", transcoder, "rewardCutUpdateTimestamp", LATER_TIMESTAMP.toString());
    assert.fieldEquals("Transcoder", transcoder, "feeShareUpdateTimestamp", LATER_TIMESTAMP.toString());
  });

  // BDR-39 known bug: set shouldFail to false when fixed
  test(
    "BDR-39: re-sending unchanged values leaves both timestamps alone",
    () => {
      seedTranscoderWithCutAndShare(REWARD_CUT, FEE_SHARE);

      transcoderUpdate(
        atTimestamp(createTranscoderUpdateEvent(TRANSCODER_A, REWARD_CUT, FEE_SHARE), LATER_TIMESTAMP)
      );

      let transcoder = TRANSCODER_A.toHex();
      assert.fieldEquals("Transcoder", transcoder, "rewardCutUpdateTimestamp", EARLIER_TIMESTAMP.toString());
      assert.fieldEquals("Transcoder", transcoder, "feeShareUpdateTimestamp", EARLIER_TIMESTAMP.toString());
    },
    true
  );

  // BDR-39 known bug: set shouldFail to false when fixed
  test(
    "BDR-39: changing only rewardCut leaves feeShareUpdateTimestamp alone",
    () => {
      seedTranscoderWithCutAndShare(BigInt.fromI32(1), FEE_SHARE);

      transcoderUpdate(
        atTimestamp(createTranscoderUpdateEvent(TRANSCODER_A, REWARD_CUT, FEE_SHARE), LATER_TIMESTAMP)
      );

      let transcoder = TRANSCODER_A.toHex();
      assert.fieldEquals("Transcoder", transcoder, "rewardCutUpdateTimestamp", LATER_TIMESTAMP.toString());
      assert.fieldEquals("Transcoder", transcoder, "feeShareUpdateTimestamp", EARLIER_TIMESTAMP.toString());
    },
    true
  );
});

// ---------------------------------------------------------------------------
// rewardCallerSet
// ---------------------------------------------------------------------------

describe("rewardCallerSet", () => {
  test("stores the reward caller on the transcoder", () => {
    rewardCallerSet(createRewardCallerSetEvent(TRANSCODER_A, DELEGATOR_B));

    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "rewardCaller", DELEGATOR_B.toHex());
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("RewardCallerSetEvent", id, "rewardCaller", DELEGATOR_B.toHex());
    assert.fieldEquals("RewardCallerSetEvent", id, "delegate", TRANSCODER_A.toHex());
  });

  test("the zero address unsets an existing reward caller", () => {
    rewardCallerSet(createRewardCallerSetEvent(TRANSCODER_A, DELEGATOR_B));
    rewardCallerSet(atLogIndex(createRewardCallerSetEvent(TRANSCODER_A, ZERO_ADDRESS), 2));

    assert.assertNull(Transcoder.load(TRANSCODER_A.toHex())!.rewardCaller);
    assert.fieldEquals(
      "RewardCallerSetEvent",
      eventId(TX_HASH, 2),
      "rewardCaller",
      ZERO_ADDRESS.toHex()
    );
  });
});

// ---------------------------------------------------------------------------
// transcoderActivated and transcoderDeactivated
// ---------------------------------------------------------------------------

function setPendingQueues(activation: string[], deactivation: string[]): void {
  let protocol = Protocol.load("0")!;
  protocol.pendingActivation = activation;
  protocol.pendingDeactivation = deactivation;
  protocol.save();
}

function setActiveTranscoderCount(count: i32): void {
  let protocol = Protocol.load("0")!;
  protocol.activeTranscoderCount = BigInt.fromI32(count);
  protocol.save();
}

describe("transcoderActivated", () => {
  test("queues the transcoder for activation next round", () => {
    transcoderActivated(createTranscoderActivatedEvent(TRANSCODER_A, BigInt.fromI32(13)));

    let transcoder = TRANSCODER_A.toHex();
    assert.fieldEquals("Transcoder", transcoder, "activationRound", "13");
    assert.fieldEquals("Transcoder", transcoder, "lastActiveStakeUpdateRound", "13");
    assert.fieldEquals("Transcoder", transcoder, "activationTimestamp", TIMESTAMP.toString());
    assert.fieldEquals(
      "Transcoder",
      transcoder,
      "deactivationRound",
      MAXIMUM_VALUE_UINT256.toString()
    );
    assert.fieldEquals("Protocol", "0", "pendingActivation", "[" + transcoder + "]");
    assert.fieldEquals("Protocol", "0", "activeTranscoderCount", "1");
    assert.fieldEquals("TranscoderActivatedEvent", eventId(TX_HASH, 1), "activationRound", "13");
  });

  test("re-activation removes the transcoder from pendingDeactivation", () => {
    setPendingQueues([], [TRANSCODER_A.toHex(), TRANSCODER_B.toHex()]);

    transcoderActivated(createTranscoderActivatedEvent(TRANSCODER_A, BigInt.fromI32(13)));

    assert.fieldEquals("Protocol", "0", "pendingDeactivation", "[" + TRANSCODER_B.toHex() + "]");
    assert.fieldEquals("Protocol", "0", "pendingActivation", "[" + TRANSCODER_A.toHex() + "]");
  });

  test("two activations in one transaction queue both transcoders", () => {
    transcoderActivated(createTranscoderActivatedEvent(TRANSCODER_A, BigInt.fromI32(13)));
    transcoderActivated(
      atLogIndex(createTranscoderActivatedEvent(TRANSCODER_B, BigInt.fromI32(13)), 2)
    );

    assert.fieldEquals(
      "Protocol",
      "0",
      "pendingActivation",
      "[" + TRANSCODER_A.toHex() + ", " + TRANSCODER_B.toHex() + "]"
    );
    assert.fieldEquals("Protocol", "0", "activeTranscoderCount", "2");
    assert.entityCount("TranscoderActivatedEvent", 2);
  });
});

describe("transcoderDeactivated", () => {
  test("queues the transcoder for deactivation and decrements the active count", () => {
    setActiveTranscoderCount(3);
    seedTranscoder(TRANSCODER_A, "Registered", "100");

    transcoderDeactivated(createTranscoderDeactivatedEvent(TRANSCODER_A, BigInt.fromI32(14)));

    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "deactivationRound", "14");
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "activationTimestamp", "0");
    assert.fieldEquals("Protocol", "0", "pendingDeactivation", "[" + TRANSCODER_A.toHex() + "]");
    assert.fieldEquals("Protocol", "0", "activeTranscoderCount", "2");
    assert.fieldEquals(
      "TranscoderDeactivatedEvent",
      eventId(TX_HASH, 1),
      "deactivationRound",
      "14"
    );
  });

  test("deactivation removes the transcoder from pendingActivation", () => {
    setPendingQueues([TRANSCODER_B.toHex(), TRANSCODER_A.toHex()], []);
    setActiveTranscoderCount(2);

    transcoderDeactivated(createTranscoderDeactivatedEvent(TRANSCODER_A, BigInt.fromI32(14)));

    assert.fieldEquals("Protocol", "0", "pendingActivation", "[" + TRANSCODER_B.toHex() + "]");
    assert.fieldEquals("Protocol", "0", "pendingDeactivation", "[" + TRANSCODER_A.toHex() + "]");
  });
});

// ---------------------------------------------------------------------------
// earningsClaimed
// ---------------------------------------------------------------------------

function claim(rewards: BigInt, fees: BigInt, endRound: i32, logIndex: i32): void {
  earningsClaimed(
    atLogIndex(
      createEarningsClaimedEvent(
        TRANSCODER_A,
        DELEGATOR_A,
        rewards,
        fees,
        BigInt.fromI32(10),
        BigInt.fromI32(endRound)
      ),
      logIndex
    )
  );
}

describe("earningsClaimed", () => {
  test("adds rewards to bondedAmount and fees to fees", () => {
    seedDelegator(DELEGATOR_A, TRANSCODER_A, "50");

    claim(tokens(5), tokens(1), 12, 1);

    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "bondedAmount", "55");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "fees", "1");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "lastClaimRound", "12");
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("EarningsClaimedEvent", id, "startRound", "10");
    assert.fieldEquals("EarningsClaimedEvent", id, "endRound", "12");
    assert.fieldEquals("EarningsClaimedEvent", id, "rewardTokens", "5");
    assert.fieldEquals("EarningsClaimedEvent", id, "fees", "1");
    assert.fieldEquals("EarningsClaimedEvent", id, "delegate", TRANSCODER_A.toHex());
    assert.fieldEquals("EarningsClaimedEvent", id, "delegator", DELEGATOR_A.toHex());
  });

  test("consecutive claims accumulate and advance lastClaimRound", () => {
    seedDelegator(DELEGATOR_A, TRANSCODER_A, "50");

    claim(tokens(5), tokens(1), 11, 1);
    claim(tokens(2), tokens(3), 12, 2);

    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "bondedAmount", "57");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "fees", "4");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "lastClaimRound", "12");
  });

  test("a zero-earnings claim only advances lastClaimRound", () => {
    seedDelegator(DELEGATOR_A, TRANSCODER_A, "50");

    claim(BigInt.zero(), BigInt.zero(), 12, 1);

    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "bondedAmount", "50");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "fees", "0");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "lastClaimRound", "12");
  });

  test("a claim by an unknown delegator creates it from the claimed amounts", () => {
    claim(tokens(5), tokens(1), 12, 1);

    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "bondedAmount", "5");
    assert.fieldEquals("Delegator", DELEGATOR_A.toHex(), "fees", "1");
    assert.fieldEquals("LivepeerAccount", DELEGATOR_A.toHex(), "delegator", DELEGATOR_A.toHex());
  });
});
