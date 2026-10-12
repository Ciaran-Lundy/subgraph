import { BigInt, log, store } from "@graphprotocol/graph-ts";
import {
  convertToDecimal,
  createOrLoadDelegator,
  createOrLoadPool,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  createOrLoadTranscoder,
  EMPTY_ADDRESS,
  getBlockNum,
  integerFromString,
  makeEventId,
  makeUnbondingLockId,
  MAXIMUM_VALUE_UINT256,
  timeseriesTimestamp,
  ONE_BI,
  updateDelegatorCounts,
  ZERO_BD,
  ZERO_BI,
} from "../../utils/helpers";
// Import event types from the registrar contract ABIs
import {
  Bond,
  BondingManager,
  EarningsClaimed,
  ParameterUpdate,
  Rebond,
  Reward,
  RewardCallerSet,
  SetController,
  TranscoderActivated,
  TranscoderDeactivated,
  TranscoderSlashed,
  TranscoderUpdate,
  TransferBond,
  TreasuryReward,
  Unbond,
  WithdrawFees,
  WithdrawStake,
} from "../types/BondingManager/BondingManager";
import {
  BondEvent,
  DelegatorRoundSnapshot,
  Transcoder,
  EarningsClaimedEvent,
  ParameterUpdateEvent,
  RebondEvent,
  RewardCallerSetEvent,
  RewardEvent,
  TranscoderActivatedEvent,
  TranscoderDeactivatedEvent,
  TranscoderSlashedEvent,
  TranscoderUpdateEvent,
  TransferBondEvent,
  TreasuryRewardEvent,
  UnbondEvent,
  UnbondingLock,
  WithdrawFeesEvent,
  WithdrawStakeEvent,
} from "../types/schema";
import { recordSetController } from "./common";
import {
  updateVotesOnBond,
  updateVotesOnReward,
  updateVotesOnUnbondOrRebond,
} from "./pollTally";

export function bond(event: Bond): void {
  let bondingManager = BondingManager.bind(event.address);
  let delegateData = bondingManager.getDelegator(event.params.newDelegate);
  let delegatorData = bondingManager.getDelegator(event.params.delegator);
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let transcoder = createOrLoadTranscoder(
    event.params.newDelegate.toHex(),
    event.block.timestamp.toI32()
  );
  let delegate = createOrLoadDelegator(
    event.params.newDelegate.toHex(),
    event.block.timestamp.toI32()
  );
  let delegator = createOrLoadDelegator(
    event.params.delegator.toHex(),
    event.block.timestamp.toI32()
  );
  let currentRound = integerFromString(round.id);
  // Stake bonded before this event (the contract's currentBondedAmount)
  let wasBonded = event.params.bondedAmount
    .minus(event.params.additionalAmount)
    .gt(ZERO_BI);
  let oldTranscoder: Transcoder | null = null;

  // If self delegating, set status and assign reference to self
  if (event.params.delegator.toHex() == event.params.newDelegate.toHex()) {
    transcoder.status = "Registered";
    transcoder.delegator = event.params.delegator.toHex();
  }

  // Changing delegate
  if (
    wasBonded &&
    event.params.oldDelegate.toHex() != event.params.newDelegate.toHex()
  ) {
    oldTranscoder = createOrLoadTranscoder(
      event.params.oldDelegate.toHex(),
      event.block.timestamp.toI32()
    );
    let oldDelegate = createOrLoadDelegator(
      event.params.oldDelegate.toHex(),
      event.block.timestamp.toI32()
    );
    let oldDelegateData = bondingManager.getDelegator(event.params.oldDelegate);

    // if previous delegate was itself, set status and unassign reference to self
    if (event.params.oldDelegate.toHex() == event.params.delegator.toHex()) {
      oldTranscoder.status = "NotRegistered";
      oldTranscoder.delegator = null;
    }

    oldTranscoder.totalStake = convertToDecimal(oldDelegateData.value3);
    updateLastActiveStakeUpdateRound(oldTranscoder, currentRound);
    oldDelegate.delegatedAmount = convertToDecimal(oldDelegateData.value3);

    oldDelegate.save();

    // keep track of how much stake moved during this round.
    round.movedStake = round.movedStake.plus(
      convertToDecimal(delegatorData.value0).minus(
        convertToDecimal(event.params.additionalAmount)
      )
    );

    // keep track of how much new stake was introduced this round
    round.newStake = round.newStake.plus(
      convertToDecimal(event.params.additionalAmount)
    );
  }

  // A delegator that fully unbonded keeps its old delegate address on-chain, so
  // oldDelegate is not a reliable "new delegator" signal; use bonded state.
  updateDelegatorCounts(
    wasBonded,
    oldTranscoder != null ? oldTranscoder : transcoder,
    true,
    transcoder,
    protocol,
    round
  );
  if (oldTranscoder != null) {
    oldTranscoder.save();
  }

  transcoder.totalStake = convertToDecimal(delegateData.value3);
  updateLastActiveStakeUpdateRound(transcoder, currentRound);
  delegate.delegatedAmount = convertToDecimal(delegateData.value3);

  delegator.delegate = event.params.newDelegate.toHex();
  delegator.lastClaimRound = round.id;
  delegator.bondedAmount = convertToDecimal(event.params.bondedAmount);
  delegator.fees = convertToDecimal(delegatorData.value1);
  delegator.startRound = delegatorData.value4;
  delegator.principal = delegator.principal.plus(
    convertToDecimal(event.params.additionalAmount)
  );

  round.save();
  delegate.save();
  delegator.save();
  transcoder.save();
  protocol.save();

  createOrLoadTransactionFromEvent(event);

  let bondEvent = new BondEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  bondEvent.transaction = event.transaction.hash.toHex();
  bondEvent.timestamp = event.block.timestamp.toI32();
  bondEvent.round = round.id;
  bondEvent.newDelegate = event.params.newDelegate.toHex();
  bondEvent.oldDelegate = event.params.oldDelegate.toHex();
  bondEvent.delegator = event.params.delegator.toHex();
  bondEvent.bondedAmount = convertToDecimal(event.params.bondedAmount);
  bondEvent.additionalAmount = convertToDecimal(event.params.additionalAmount);
  bondEvent.save();

  updateVotesOnBond(
    protocol,
    getBlockNum(protocol, event.block),
    event.params.delegator.toHex(),
    event.params.oldDelegate.toHex(),
    event.params.newDelegate.toHex(),
    event.params.bondedAmount,
    event.params.additionalAmount
  );
}

export function transferBond(event: TransferBond): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let delegator = createOrLoadDelegator(
    event.params.newDelegator.toHex(),
    event.block.timestamp.toI32()
  );
  let oldUniqueUnbondingLockId = makeUnbondingLockId(
    event.params.oldDelegator,
    event.params.oldUnbondingLockId
  );
  let newUniqueUnbondingLockId = makeUnbondingLockId(
    event.params.newDelegator,
    event.params.newUnbondingLockId
  );

  // update delegator's principal
  delegator.principal = delegator.principal.plus(
    convertToDecimal(event.params.amount)
  );

  delegator.save();

  // Add unbonding lock for new delegator since it was transferred from the old delegator
  let newUnbondingLock = UnbondingLock.load(newUniqueUnbondingLockId);
  if (newUnbondingLock === null) {
    newUnbondingLock = new UnbondingLock(newUniqueUnbondingLockId);
  }

  // The old lock is written by the Unbond handler earlier in this transaction.
  // It cannot be recovered with an eth_call: transferBond() deletes it on-chain
  // before emitting TransferBond, and the old delegator's delegate is cleared
  // on a full unbond.
  let oldUnbondingLock = UnbondingLock.load(oldUniqueUnbondingLockId);
  if (oldUnbondingLock === null) {
    log.warning(
      "TransferBond: unbonding lock {} not found, skipping lock transfer to {}",
      [oldUniqueUnbondingLockId, newUniqueUnbondingLockId]
    );
  } else {
    newUnbondingLock.unbondingLockId = event.params.newUnbondingLockId.toI32();
    newUnbondingLock.delegator = event.params.newDelegator.toHex();
    newUnbondingLock.sender = event.params.oldDelegator.toHex();
    newUnbondingLock.delegate = oldUnbondingLock.delegate;
    newUnbondingLock.withdrawRound = oldUnbondingLock.withdrawRound;
    newUnbondingLock.amount = convertToDecimal(event.params.amount);

    newUnbondingLock.save();

    // Remove unbonding lock for old delegator since it has been transferred to the new delegator
    store.remove("UnbondingLock", oldUniqueUnbondingLockId);
  }

  createOrLoadTransactionFromEvent(event);
  let transferBondEvent = new TransferBondEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  transferBondEvent.transaction = event.transaction.hash.toHex();
  transferBondEvent.timestamp = event.block.timestamp.toI32();
  transferBondEvent.round = round.id;
  transferBondEvent.amount = convertToDecimal(event.params.amount);
  transferBondEvent.newDelegator = event.params.newDelegator.toHex();
  transferBondEvent.oldDelegator = event.params.oldDelegator.toHex();
  transferBondEvent.newUnbondingLockId =
    event.params.newUnbondingLockId.toI32();
  transferBondEvent.oldUnbondingLockId =
    event.params.oldUnbondingLockId.toI32();
  transferBondEvent.save();
}

// Handler for Unbond events
export function unbond(event: Unbond): void {
  let bondingManager = BondingManager.bind(event.address);
  let uniqueUnbondingLockId = makeUnbondingLockId(
    event.params.delegator,
    event.params.unbondingLockId
  );
  let withdrawRound = event.params.withdrawRound;
  let amount = convertToDecimal(event.params.amount);
  let delegator = createOrLoadDelegator(
    event.params.delegator.toHex(),
    event.block.timestamp.toI32()
  );
  let delegateData = bondingManager.getDelegator(event.params.delegate);
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let transcoder = createOrLoadTranscoder(
    event.params.delegate.toHex(),
    event.block.timestamp.toI32()
  );
  let delegate = createOrLoadDelegator(
    event.params.delegate.toHex(),
    event.block.timestamp.toI32()
  );
  let unbondingLock = UnbondingLock.load(uniqueUnbondingLockId);
  if (unbondingLock === null) {
    unbondingLock = new UnbondingLock(uniqueUnbondingLockId);
  }

  delegate.delegatedAmount = convertToDecimal(delegateData.value3);
  transcoder.totalStake = convertToDecimal(delegateData.value3);
  updateLastActiveStakeUpdateRound(transcoder, integerFromString(round.id));

  let delegatorData = bondingManager.getDelegator(event.params.delegator);
  // unbond() requires the delegator to be bonded
  updateDelegatorCounts(
    true,
    transcoder,
    !delegatorData.value0.isZero(),
    transcoder,
    protocol,
    round
  );
  delegator.lastClaimRound = round.id;
  delegator.bondedAmount = convertToDecimal(delegatorData.value0);
  delegator.fees = convertToDecimal(delegatorData.value1);
  delegator.startRound = delegatorData.value4;
  delegator.unbonded = delegator.unbonded.plus(
    convertToDecimal(event.params.amount)
  );

  // Delegator no longer delegated to anyone if it does not have a bonded amount
  // so remove it from delegate
  if (delegatorData.value0.isZero()) {
    // If unbonding from self and no longer has a bonded amount
    // update transcoder status and delegator
    if (event.params.delegator.toHex() == event.params.delegate.toHex()) {
      transcoder.status = "NotRegistered";
      transcoder.delegator = null;
    }

    // Update delegator's delegate
    delegator.delegate = null;
  }

  unbondingLock.unbondingLockId = event.params.unbondingLockId.toI32();
  unbondingLock.delegator = event.params.delegator.toHex();
  unbondingLock.sender = event.params.delegator.toHex();
  unbondingLock.delegate = event.params.delegate.toHex();
  unbondingLock.withdrawRound = withdrawRound;
  unbondingLock.amount = amount;

  // Apply store updates
  delegate.save();
  transcoder.save();
  unbondingLock.save();
  delegator.save();
  protocol.save();
  round.save();

  createOrLoadTransactionFromEvent(event);

  let unbondEvent = new UnbondEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  unbondEvent.transaction = event.transaction.hash.toHex();
  unbondEvent.timestamp = event.block.timestamp.toI32();
  unbondEvent.round = round.id;
  unbondEvent.amount = amount;
  unbondEvent.withdrawRound = unbondingLock.withdrawRound;
  unbondEvent.unbondingLockId = event.params.unbondingLockId.toI32();
  unbondEvent.delegate = event.params.delegate.toHex();
  unbondEvent.delegator = delegator.id;
  unbondEvent.save();

  updateVotesOnUnbondOrRebond(
    protocol,
    getBlockNum(protocol, event.block),
    round.id,
    event.params.delegator.toHex(),
    event.params.delegate.toHex()
  );
}

// Handler for Rebond events
export function rebond(event: Rebond): void {
  let bondingManager = BondingManager.bind(event.address);
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let transcoder = createOrLoadTranscoder(
    event.params.delegate.toHex(),
    event.block.timestamp.toI32()
  );
  let delegate = createOrLoadDelegator(
    event.params.delegate.toHex(),
    event.block.timestamp.toI32()
  );
  let delegator = createOrLoadDelegator(
    event.params.delegator.toHex(),
    event.block.timestamp.toI32()
  );
  let delegateData = bondingManager.getDelegator(event.params.delegate);
  let uniqueUnbondingLockId = makeUnbondingLockId(
    event.params.delegator,
    event.params.unbondingLockId
  );
  let unbondingLock = UnbondingLock.load(uniqueUnbondingLockId);

  let wasBonded = delegator.bondedAmount.gt(ZERO_BD);

  // If rebonding from unbonded
  if (!wasBonded) {
    // If self-bonding then update transcoder status
    if (event.params.delegate.toHex() == event.params.delegator.toHex()) {
      transcoder.status = "Registered";
      transcoder.delegator = event.params.delegator.toHex();
    }
  }
  updateDelegatorCounts(
    wasBonded,
    transcoder,
    true,
    transcoder,
    protocol,
    round
  );

  // update delegator
  let delegatorData = bondingManager.getDelegator(event.params.delegator);
  delegator.delegate = event.params.delegate.toHex();
  delegator.startRound = delegatorData.value4;
  delegator.lastClaimRound = round.id;
  delegator.bondedAmount = convertToDecimal(delegatorData.value0);
  delegator.fees = convertToDecimal(delegatorData.value1);

  // If the sender field for the lock is equal to the delegator's address then
  // we know that this is an unbonding lock the delegator created by calling
  // unbond() and if it is not then we know that this is an unbonding lock created
  // by transferBond(). In the latter case, we wouldn't need to subtract from unbonded.
  if (unbondingLock && unbondingLock.sender == event.params.delegator.toHex()) {
    delegator.unbonded = delegator.unbonded.minus(
      convertToDecimal(event.params.amount)
    );
  }

  // update delegate
  delegate.delegatedAmount = convertToDecimal(delegateData.value3);
  transcoder.totalStake = convertToDecimal(delegateData.value3);
  updateLastActiveStakeUpdateRound(transcoder, integerFromString(round.id));

  // Apply store updates
  delegate.save();
  transcoder.save();
  delegator.save();
  protocol.save();
  round.save();

  if (unbondingLock) {
    store.remove("UnbondingLock", uniqueUnbondingLockId);
  }

  createOrLoadTransactionFromEvent(event);

  let rebondEvent = new RebondEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  rebondEvent.transaction = event.transaction.hash.toHex();
  rebondEvent.timestamp = event.block.timestamp.toI32();
  rebondEvent.round = round.id;
  rebondEvent.delegator = delegator.id;
  rebondEvent.delegate = delegate.id;
  rebondEvent.amount = convertToDecimal(event.params.amount);
  rebondEvent.unbondingLockId = event.params.unbondingLockId.toI32();
  rebondEvent.save();

  updateVotesOnUnbondOrRebond(
    protocol,
    getBlockNum(protocol, event.block),
    round.id,
    event.params.delegator.toHex(),
    event.params.delegate.toHex()
  );
}

// Handler for WithdrawStake events
export function withdrawStake(event: WithdrawStake): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  let uniqueUnbondingLockId = makeUnbondingLockId(
    event.params.delegator,
    event.params.unbondingLockId
  );
  store.remove("UnbondingLock", uniqueUnbondingLockId);

  createOrLoadTransactionFromEvent(event);

  let withdrawStakeEvent = new WithdrawStakeEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  withdrawStakeEvent.transaction = event.transaction.hash.toHex();
  withdrawStakeEvent.timestamp = event.block.timestamp.toI32();
  withdrawStakeEvent.round = round.id;
  withdrawStakeEvent.amount = convertToDecimal(event.params.amount);
  withdrawStakeEvent.unbondingLockId = event.params.unbondingLockId.toI32();
  withdrawStakeEvent.delegator = event.params.delegator.toHex();
  withdrawStakeEvent.save();
}

export function withdrawFees(event: WithdrawFees): void {
  let bondingManager = BondingManager.bind(event.address);
  let delegator = createOrLoadDelegator(
    event.params.delegator.toHex(),
    event.block.timestamp.toI32()
  );
  let delegatorData = bondingManager.getDelegator(event.params.delegator);
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let withdrawFeesEvent = new WithdrawFeesEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  withdrawFeesEvent.transaction = event.transaction.hash.toHex();
  withdrawFeesEvent.timestamp = event.block.timestamp.toI32();
  withdrawFeesEvent.round = round.id;
  withdrawFeesEvent.amount = convertToDecimal(event.params.amount);
  withdrawFeesEvent.recipient = event.params.recipient.toHex();
  withdrawFeesEvent.delegator = event.params.delegator.toHex();
  withdrawFeesEvent.save();

  delegator.bondedAmount = convertToDecimal(delegatorData.value0);
  delegator.fees = convertToDecimal(delegatorData.value1);
  delegator.withdrawnFees = delegator.withdrawnFees.plus(
    withdrawFeesEvent.amount
  );
  delegator.lastClaimRound = round.id;
  delegator.save();
}

export function parameterUpdate(event: ParameterUpdate): void {
  let bondingManager = BondingManager.bind(event.address);
  let protocol = createOrLoadProtocol();

  if (event.params.param == "unbondingPeriod") {
    protocol.unbondingPeriod = bondingManager.unbondingPeriod();
  }

  if (event.params.param == "numActiveTranscoders") {
    protocol.numActiveTranscoders = bondingManager.getTranscoderPoolMaxSize();
  }

  protocol.save();

  createOrLoadTransactionFromEvent(event);

  let parameterUpdateEvent = new ParameterUpdateEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  parameterUpdateEvent.transaction = event.transaction.hash.toHex();
  parameterUpdateEvent.timestamp = event.block.timestamp.toI32();
  parameterUpdateEvent.param = event.params.param;
  parameterUpdateEvent.round = protocol.currentRound;
  parameterUpdateEvent.save();
}

// Handler for Reward events
export function reward(event: Reward): void {
  let transcoder = createOrLoadTranscoder(
    event.params.transcoder.toHex(),
    event.block.timestamp.toI32()
  );
  let delegate = createOrLoadDelegator(
    event.params.transcoder.toHex(),
    event.block.timestamp.toI32()
  );
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let pool = createOrLoadPool(round.id, event.params.transcoder.toHex());

  delegate.delegatedAmount = delegate.delegatedAmount.plus(
    convertToDecimal(event.params.amount)
  );

  transcoder.totalStake = transcoder.totalStake.plus(
    convertToDecimal(event.params.amount)
  );
  transcoder.lastRewardRound = round.id;
  updateLastActiveStakeUpdateRound(transcoder, integerFromString(round.id));

  pool.rewardTokens = convertToDecimal(event.params.amount);
  pool.feeShare = transcoder.feeShare;
  pool.rewardCut = transcoder.rewardCut;

  transcoder.save();
  delegate.save();
  pool.save();
  protocol.save();

  createOrLoadTransactionFromEvent(event);

  let rewardEvent = new RewardEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  rewardEvent.transaction = event.transaction.hash.toHex();
  rewardEvent.timestamp = event.block.timestamp.toI32();
  rewardEvent.round = round.id;
  rewardEvent.rewardTokens = convertToDecimal(event.params.amount);
  rewardEvent.delegate = event.params.transcoder.toHex();
  rewardEvent.save();

  updateVotesOnReward(
    protocol,
    getBlockNum(protocol, event.block),
    round.id,
    transcoder
  );
}

// Handler for TranscoderSlashed events
export function transcoderSlashed(event: TranscoderSlashed): void {
  let transcoder = createOrLoadTranscoder(
    event.params.transcoder.toHex(),
    event.block.timestamp.toI32()
  );
  let bondingManager = BondingManager.bind(event.address);
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let delegateData = bondingManager.getDelegator(event.params.transcoder);

  // Update transcoder total stake
  transcoder.totalStake = convertToDecimal(delegateData.value3);

  // Apply store updates
  transcoder.save();

  createOrLoadTransactionFromEvent(event);

  let transcoderSlashedEvent = new TranscoderSlashedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  transcoderSlashedEvent.transaction = event.transaction.hash.toHex();
  transcoderSlashedEvent.timestamp = event.block.timestamp.toI32();
  transcoderSlashedEvent.round = round.id;
  transcoderSlashedEvent.delegate = event.params.transcoder.toHex();
  transcoderSlashedEvent.finder = event.params.finder;
  transcoderSlashedEvent.penalty = convertToDecimal(event.params.penalty);
  transcoderSlashedEvent.finderReward = event.params.finderReward;
  transcoderSlashedEvent.save();
}

export function transcoderUpdate(event: TranscoderUpdate): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let transcoder = createOrLoadTranscoder(
    event.params.transcoder.toHex(),
    event.block.timestamp.toI32()
  );
  if (transcoder.rewardCut.notEqual(event.params.rewardCut)) {
    transcoder.rewardCut = event.params.rewardCut;
    transcoder.rewardCutUpdateTimestamp = event.block.timestamp.toI32();
  }
  if (transcoder.feeShare.notEqual(event.params.feeShare)) {
    transcoder.feeShare = event.params.feeShare;
    transcoder.feeShareUpdateTimestamp = event.block.timestamp.toI32();
  }
  transcoder.save();

  createOrLoadTransactionFromEvent(event);

  let transcoderUpdateEvent = new TranscoderUpdateEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  transcoderUpdateEvent.transaction = event.transaction.hash.toHex();
  transcoderUpdateEvent.timestamp = event.block.timestamp.toI32();
  transcoderUpdateEvent.round = round.id;
  transcoderUpdateEvent.rewardCut = event.params.rewardCut;
  transcoderUpdateEvent.feeShare = event.params.feeShare;
  transcoderUpdateEvent.delegate = event.params.transcoder.toHex();
  transcoderUpdateEvent.save();
}

export function rewardCallerSet(event: RewardCallerSet): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let transcoder = createOrLoadTranscoder(
    event.params.transcoder.toHex(),
    event.block.timestamp.toI32()
  );

  // The zero address unsets the reward caller
  if (event.params.rewardCaller.toHex() == EMPTY_ADDRESS.toHex()) {
    transcoder.rewardCaller = null;
  } else {
    transcoder.rewardCaller = event.params.rewardCaller.toHex();
  }
  transcoder.save();

  createOrLoadTransactionFromEvent(event);

  let rewardCallerSetEvent = new RewardCallerSetEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  rewardCallerSetEvent.transaction = event.transaction.hash.toHex();
  rewardCallerSetEvent.timestamp = event.block.timestamp.toI32();
  rewardCallerSetEvent.round = round.id;
  rewardCallerSetEvent.delegate = event.params.transcoder.toHex();
  rewardCallerSetEvent.rewardCaller = event.params.rewardCaller.toHex();
  rewardCallerSetEvent.save();
}

export function transcoderActivated(event: TranscoderActivated): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let transcoder = createOrLoadTranscoder(
    event.params.transcoder.toHex(),
    event.block.timestamp.toI32()
  );

  transcoder.activationTimestamp = event.block.timestamp.toI32();
  transcoder.lastActiveStakeUpdateRound = event.params.activationRound;
  transcoder.activationRound = event.params.activationRound;
  transcoder.deactivationRound = MAXIMUM_VALUE_UINT256;
  transcoder.save();

  // if transcoder was pending deactivation, remove it from deactivation array
  let pendingDeactivation = protocol.pendingDeactivation;
  if (pendingDeactivation.includes(event.params.transcoder.toHex())) {
    let index = pendingDeactivation.indexOf(event.params.transcoder.toHex());
    pendingDeactivation.splice(index, 1);
    protocol.pendingDeactivation = pendingDeactivation;
  }

  protocol.activeTranscoderCount = protocol.activeTranscoderCount.plus(ONE_BI);

  // Add transcoder to list of transcoders pending activation
  let pendingActivation = protocol.pendingActivation;
  pendingActivation.push(event.params.transcoder.toHex());
  protocol.pendingActivation = pendingActivation;
  protocol.save();

  createOrLoadTransactionFromEvent(event);

  let transcoderActivatedEvent = new TranscoderActivatedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  transcoderActivatedEvent.transaction = event.transaction.hash.toHex();
  transcoderActivatedEvent.timestamp = event.block.timestamp.toI32();
  transcoderActivatedEvent.round = round.id;
  transcoderActivatedEvent.activationRound = event.params.activationRound;
  transcoderActivatedEvent.delegate = event.params.transcoder.toHex();
  transcoderActivatedEvent.save();
}

export function transcoderDeactivated(event: TranscoderDeactivated): void {
  let transcoder = createOrLoadTranscoder(
    event.params.transcoder.toHex(),
    event.block.timestamp.toI32()
  );
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  transcoder.activationTimestamp = 0;
  transcoder.deactivationRound = event.params.deactivationRound;
  transcoder.save();

  // if transcoder was pending activation, remove it from activation array
  let pendingActivation = protocol.pendingActivation;
  if (pendingActivation.includes(event.params.transcoder.toHex())) {
    let index = pendingActivation.indexOf(event.params.transcoder.toHex());
    pendingActivation.splice(index, 1);
    protocol.pendingActivation = pendingActivation;
  }

  protocol.activeTranscoderCount = protocol.activeTranscoderCount.minus(ONE_BI);

  // Add transcoder to list of transcoders pending deactivation
  let pendingDeactivation = protocol.pendingDeactivation;
  pendingDeactivation.push(event.params.transcoder.toHex());
  protocol.pendingDeactivation = pendingDeactivation;
  protocol.save();

  createOrLoadTransactionFromEvent(event);

  let transcoderDeactivatedEvent = new TranscoderDeactivatedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  transcoderDeactivatedEvent.transaction = event.transaction.hash.toHex();
  transcoderDeactivatedEvent.timestamp = event.block.timestamp.toI32();
  transcoderDeactivatedEvent.round = round.id;
  transcoderDeactivatedEvent.deactivationRound = event.params.deactivationRound;
  transcoderDeactivatedEvent.delegate = event.params.transcoder.toHex();
  transcoderDeactivatedEvent.save();
}

export function earningsClaimed(event: EarningsClaimed): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let delegator = createOrLoadDelegator(
    event.params.delegator.toHex(),
    event.block.timestamp.toI32()
  );
  delegator.lastClaimRound = event.params.endRound.toString();
  delegator.bondedAmount = delegator.bondedAmount.plus(
    convertToDecimal(event.params.rewards)
  );
  delegator.fees = delegator.fees.plus(convertToDecimal(event.params.fees));
  delegator.save();

  createOrLoadTransactionFromEvent(event);

  let earningsClaimedEvent = new EarningsClaimedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  earningsClaimedEvent.transaction = event.transaction.hash.toHex();
  earningsClaimedEvent.timestamp = event.block.timestamp.toI32();
  earningsClaimedEvent.round = round.id;
  earningsClaimedEvent.delegate = event.params.delegate.toHex();
  earningsClaimedEvent.delegator = event.params.delegator.toHex();
  earningsClaimedEvent.startRound = event.params.startRound;
  earningsClaimedEvent.endRound = event.params.endRound.toString();
  earningsClaimedEvent.rewardTokens = convertToDecimal(event.params.rewards);
  earningsClaimedEvent.fees = convertToDecimal(event.params.fees);
  earningsClaimedEvent.save();
  // graph-node assigns the id and overwrites the timestamp
  let snapshot = new DelegatorRoundSnapshot(0);
  snapshot.timestamp = timeseriesTimestamp(event.block);
  snapshot.delegator = delegator.id;
  snapshot.delegate = event.params.delegate.toHex();
  snapshot.round = event.params.endRound;
  snapshot.bondedAmount = delegator.bondedAmount;
  snapshot.rewardTokens = earningsClaimedEvent.rewardTokens;
  snapshot.fees = earningsClaimedEvent.fees;
  snapshot.save();
}

// Mirrors BondingManager.increaseTotalStake()/decreaseTotalStake(), which move
// lastActiveStakeUpdateRound to currentRound + 1 only when the transcoder is
// active in the current round or will be active in the next one.
function updateLastActiveStakeUpdateRound(
  transcoder: Transcoder,
  currentRound: BigInt
): void {
  let nextRound = currentRound.plus(ONE_BI);
  if (
    transcoder.activationRound.gt(ZERO_BI) &&
    transcoder.activationRound.le(nextRound) &&
    transcoder.deactivationRound.gt(currentRound)
  ) {
    transcoder.lastActiveStakeUpdateRound = nextRound;
  }
}

export function treasuryReward(event: TreasuryReward): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  createOrLoadTranscoder(
    event.params.transcoder.toHex(),
    event.block.timestamp.toI32()
  );

  createOrLoadTransactionFromEvent(event);

  let treasuryRewardEvent = new TreasuryRewardEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  treasuryRewardEvent.transaction = event.transaction.hash.toHex();
  treasuryRewardEvent.timestamp = event.block.timestamp.toI32();
  treasuryRewardEvent.round = round.id;
  treasuryRewardEvent.delegate = event.params.transcoder.toHex();
  treasuryRewardEvent.treasury = event.params.treasury.toHex();
  treasuryRewardEvent.amount = convertToDecimal(event.params.amount);
  treasuryRewardEvent.save();
}

export function setController(event: SetController): void {
  recordSetController(event, event.params.controller);
}
