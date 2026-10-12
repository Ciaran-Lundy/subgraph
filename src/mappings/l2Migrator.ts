import {
  convertToDecimal,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  getBlockNum,
  makeEventId,
} from "../../utils/helpers";
import {
  DelegatorPoolCreated,
  MigrateDelegatorFinalized,
  MigrateSenderFinalized,
  MigrateUnbondingLocksFinalized,
  StakeClaimed,
} from "../types/L2Migrator/L2Migrator";
import {
  DelegatorPoolCreatedEvent,
  MigrateDelegatorFinalizedEvent,
  MigrateSenderFinalizedEvent,
  MigrateUnbondingLocksFinalizedEvent,
  StakeClaimedEvent,
} from "../types/schema";

export function migrateDelegatorFinalized(
  event: MigrateDelegatorFinalized
): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let migrateDelegatorFinalizedEvent = new MigrateDelegatorFinalizedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  migrateDelegatorFinalizedEvent.transaction = event.transaction.hash;
  migrateDelegatorFinalizedEvent.timestamp = event.block.timestamp.toI32();
  migrateDelegatorFinalizedEvent.round = round.id;
  migrateDelegatorFinalizedEvent.l1Addr = event.params.params.l1Addr.toHex();
  migrateDelegatorFinalizedEvent.l2Addr = event.params.params.l2Addr.toHex();
  migrateDelegatorFinalizedEvent.stake = convertToDecimal(
    event.params.params.stake
  );
  migrateDelegatorFinalizedEvent.delegatedStake = convertToDecimal(
    event.params.params.delegatedStake
  );
  migrateDelegatorFinalizedEvent.fees = convertToDecimal(
    event.params.params.fees
  );
  migrateDelegatorFinalizedEvent.delegate =
    event.params.params.delegate.toHex();
  migrateDelegatorFinalizedEvent.save();
}

export function stakeClaimed(event: StakeClaimed): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let stakeClaimedEvent = new StakeClaimedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  stakeClaimedEvent.transaction = event.transaction.hash;
  stakeClaimedEvent.timestamp = event.block.timestamp.toI32();
  stakeClaimedEvent.round = round.id;
  stakeClaimedEvent.delegator = event.params.delegator.toHex();
  stakeClaimedEvent.delegate = event.params.delegate.toHex();
  stakeClaimedEvent.stake = convertToDecimal(event.params.stake);
  stakeClaimedEvent.fees = convertToDecimal(event.params.fees);
  stakeClaimedEvent.save();
}

export function migrateSenderFinalized(event: MigrateSenderFinalized): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let migrateSenderFinalizedEvent = new MigrateSenderFinalizedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  migrateSenderFinalizedEvent.transaction = event.transaction.hash;
  migrateSenderFinalizedEvent.timestamp = event.block.timestamp.toI32();
  migrateSenderFinalizedEvent.round = round.id;
  migrateSenderFinalizedEvent.l1Addr = event.params.params.l1Addr.toHex();
  migrateSenderFinalizedEvent.l2Addr = event.params.params.l2Addr.toHex();
  migrateSenderFinalizedEvent.deposit = convertToDecimal(
    event.params.params.deposit
  );
  migrateSenderFinalizedEvent.reserve = convertToDecimal(
    event.params.params.reserve
  );
  migrateSenderFinalizedEvent.save();
}

export function migrateUnbondingLocksFinalized(
  event: MigrateUnbondingLocksFinalized
): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let migrateUnbondingLocksFinalizedEvent =
    new MigrateUnbondingLocksFinalizedEvent(
      makeEventId(event.transaction.hash, event.logIndex)
    );
  migrateUnbondingLocksFinalizedEvent.transaction = event.transaction.hash;
  migrateUnbondingLocksFinalizedEvent.timestamp =
    event.block.timestamp.toI32();
  migrateUnbondingLocksFinalizedEvent.round = round.id;
  migrateUnbondingLocksFinalizedEvent.l1Addr =
    event.params.params.l1Addr.toHex();
  migrateUnbondingLocksFinalizedEvent.l2Addr =
    event.params.params.l2Addr.toHex();
  migrateUnbondingLocksFinalizedEvent.total = convertToDecimal(
    event.params.params.total
  );
  migrateUnbondingLocksFinalizedEvent.unbondingLockIds =
    event.params.params.unbondingLockIds;
  migrateUnbondingLocksFinalizedEvent.delegate =
    event.params.params.delegate.toHex();
  migrateUnbondingLocksFinalizedEvent.save();
}

export function delegatorPoolCreated(event: DelegatorPoolCreated): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let delegatorPoolCreatedEvent = new DelegatorPoolCreatedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  delegatorPoolCreatedEvent.transaction = event.transaction.hash;
  delegatorPoolCreatedEvent.timestamp = event.block.timestamp.toI32();
  delegatorPoolCreatedEvent.round = round.id;
  delegatorPoolCreatedEvent.l1Addr = event.params.l1Addr.toHex();
  delegatorPoolCreatedEvent.delegatorPool = event.params.delegatorPool.toHex();
  delegatorPoolCreatedEvent.save();
}
