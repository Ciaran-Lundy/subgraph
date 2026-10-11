import {
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  getBlockNum,
  makeEventId,
} from "../../utils/helpers";
import {
  TreasuryCallExecutedEvent,
  TreasuryCallScheduledEvent,
  TreasuryMinDelayChangeEvent,
  TreasuryOperationCancelledEvent,
} from "../types/schema";
// Treasury.sol only wraps TimelockControllerUpgradeable, whose events these are
import {
  CallExecuted,
  CallScheduled,
  Cancelled,
  MinDelayChange,
} from "../types/TreasuryTimelock/Treasury";

export function callScheduled(event: CallScheduled): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let callScheduledEvent = new TreasuryCallScheduledEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  callScheduledEvent.transaction = event.transaction.hash.toHex();
  callScheduledEvent.timestamp = event.block.timestamp.toI32();
  callScheduledEvent.round = round.id;
  callScheduledEvent.operationId = event.params.id;
  callScheduledEvent.index = event.params.index;
  callScheduledEvent.target = event.params.target.toHex();
  callScheduledEvent.value = event.params.value;
  callScheduledEvent.data = event.params.data;
  callScheduledEvent.predecessor = event.params.predecessor;
  callScheduledEvent.delay = event.params.delay;
  callScheduledEvent.save();
}

export function callExecuted(event: CallExecuted): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let callExecutedEvent = new TreasuryCallExecutedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  callExecutedEvent.transaction = event.transaction.hash.toHex();
  callExecutedEvent.timestamp = event.block.timestamp.toI32();
  callExecutedEvent.round = round.id;
  callExecutedEvent.operationId = event.params.id;
  callExecutedEvent.index = event.params.index;
  callExecutedEvent.target = event.params.target.toHex();
  callExecutedEvent.value = event.params.value;
  callExecutedEvent.data = event.params.data;
  callExecutedEvent.save();
}

export function cancelled(event: Cancelled): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let cancelledEvent = new TreasuryOperationCancelledEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  cancelledEvent.transaction = event.transaction.hash.toHex();
  cancelledEvent.timestamp = event.block.timestamp.toI32();
  cancelledEvent.round = round.id;
  cancelledEvent.operationId = event.params.id;
  cancelledEvent.save();
}

export function minDelayChange(event: MinDelayChange): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let minDelayChangeEvent = new TreasuryMinDelayChangeEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  minDelayChangeEvent.transaction = event.transaction.hash.toHex();
  minDelayChangeEvent.timestamp = event.block.timestamp.toI32();
  minDelayChangeEvent.round = round.id;
  minDelayChangeEvent.oldDuration = event.params.oldDuration;
  minDelayChangeEvent.newDuration = event.params.newDuration;
  minDelayChangeEvent.save();
}
