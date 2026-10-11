import {
  convertToDecimal,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  getBlockNum,
  makeEventId,
} from "../../utils/helpers";
import {
  DelegateChanged,
  DelegateVotesChanged,
  DelegatorBondedAmountChanged,
} from "../types/BondingVotes/BondingVotes";
import {
  DelegateChangedEvent,
  DelegateVotesChangedEvent,
  DelegatorBondedAmountChangedEvent,
} from "../types/schema";

export function delegatorBondedAmountChanged(
  event: DelegatorBondedAmountChanged
): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let changedEvent = new DelegatorBondedAmountChangedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  changedEvent.transaction = event.transaction.hash.toHex();
  changedEvent.timestamp = event.block.timestamp.toI32();
  changedEvent.round = round.id;
  // The ABI names this parameter "delegate", but BondingVotes emits it for the
  // account whose own bonding checkpoint changed
  changedEvent.delegator = event.params.delegate.toHex();
  changedEvent.previousBondedAmount = convertToDecimal(
    event.params.previousBondedAmount
  );
  changedEvent.previousLastClaimRound = event.params.previousLastClaimRound;
  changedEvent.newBondedAmount = convertToDecimal(
    event.params.newBondedAmount
  );
  changedEvent.newLastClaimRound = event.params.newLastClaimRound;
  changedEvent.save();
}

export function delegateChanged(event: DelegateChanged): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let delegateChangedEvent = new DelegateChangedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  delegateChangedEvent.transaction = event.transaction.hash.toHex();
  delegateChangedEvent.timestamp = event.block.timestamp.toI32();
  delegateChangedEvent.round = round.id;
  delegateChangedEvent.delegator = event.params.delegator.toHex();
  delegateChangedEvent.fromDelegate = event.params.fromDelegate.toHex();
  delegateChangedEvent.toDelegate = event.params.toDelegate.toHex();
  delegateChangedEvent.save();
}

export function delegateVotesChanged(event: DelegateVotesChanged): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let delegateVotesChangedEvent = new DelegateVotesChangedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  delegateVotesChangedEvent.transaction = event.transaction.hash.toHex();
  delegateVotesChangedEvent.timestamp = event.block.timestamp.toI32();
  delegateVotesChangedEvent.round = round.id;
  delegateVotesChangedEvent.delegate = event.params.delegate.toHex();
  delegateVotesChangedEvent.previousBalance = convertToDecimal(
    event.params.previousBalance
  );
  delegateVotesChangedEvent.newBalance = convertToDecimal(
    event.params.newBalance
  );
  delegateVotesChangedEvent.save();
}
