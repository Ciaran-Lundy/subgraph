import { BigInt } from "@graphprotocol/graph-ts";
import {
  addRecentFeeVolume,
  convertToDecimal,
  createOrLoadBroadcaster,
  createOrLoadPool,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  createOrLoadTranscoder,
  getBlockNum,
  getEthPriceUsd,
  makeEventId,
  ONE_BI,
  recordProtocolDataPoint,
  timeseriesTimestamp,
  ZERO_BD,
} from "../../utils/helpers";
import {
  DepositFundedEvent,
  FeeDataPoint,
  ParameterUpdateEvent,
  UnlockCancelledEvent,
  UnlockEvent,
  ReserveClaimedEvent,
  ReserveFundedEvent,
  WinningTicketRedeemedEvent,
  WinningTicketTransferEvent,
  WithdrawalEvent,
} from "../types/schema";
import {
  DepositFunded,
  ParameterUpdate,
  ReserveClaimed,
  ReserveFunded,
  SetController,
  Unlock,
  UnlockCancelled,
  WinningTicketRedeemed,
  WinningTicketTransfer,
  Withdrawal,
} from "../types/TicketBroker/TicketBroker";
import { recordSetController } from "./common";

export function winningTicketRedeemed(event: WinningTicketRedeemed): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let timestamp = event.block.timestamp.toI32();
  let winningTicketRedeemedEvent = new WinningTicketRedeemedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  let faceValue = convertToDecimal(event.params.faceValue);
  let ethPrice = getEthPriceUsd(protocol, event.block);
  let faceValueUSD = faceValue.times(ethPrice);

  // WinningTicketRedeemed only carries faceValue. The amount actually paid
  // (deposit plus a possibly capped reserve claim) is on WinningTicketTransfer,
  // which redeemWinningTicket() emits immediately before this event, and only
  // when the amount is non-zero. Match on the adjacent log index rather than
  // the transaction alone, since batchRedeemWinningTickets() redeems several
  // tickets per transaction.
  let amount = ZERO_BD;
  if (event.logIndex.gt(BigInt.zero())) {
    let transfer = WinningTicketTransferEvent.load(
      makeEventId(event.transaction.hash, event.logIndex.minus(ONE_BI))
    );
    if (transfer) {
      amount = transfer.amount;
    }
  }
  let amountUSD = amount.times(ethPrice);

  createOrLoadTransactionFromEvent(event);

  winningTicketRedeemedEvent.transaction = event.transaction.hash.toHex();
  winningTicketRedeemedEvent.timestamp = event.block.timestamp.toI32();
  winningTicketRedeemedEvent.round = round.id;
  winningTicketRedeemedEvent.sender = event.params.sender.toHex();
  winningTicketRedeemedEvent.recipient = event.params.recipient.toHex();
  winningTicketRedeemedEvent.faceValue = faceValue;
  winningTicketRedeemedEvent.faceValueUSD = faceValueUSD;
  winningTicketRedeemedEvent.winProb = event.params.winProb;
  winningTicketRedeemedEvent.senderNonce = event.params.senderNonce;
  winningTicketRedeemedEvent.recipientRand = event.params.recipientRand;
  winningTicketRedeemedEvent.auxData = event.params.auxData;
  winningTicketRedeemedEvent.save();

  // The faceValue of the ticket is subtracted from the sender's deposit, down
  // to zero. Any shortfall is claimed from the reserve, which the
  // ReserveClaimed handler already deducts with the actual (capped) amount.
  let broadcaster = createOrLoadBroadcaster(event.params.sender.toHex());
  if (faceValue.gt(broadcaster.deposit)) {
    broadcaster.deposit = ZERO_BD;
  } else {
    broadcaster.deposit = broadcaster.deposit.minus(faceValue);
  }

  broadcaster.totalVolumeETH = broadcaster.totalVolumeETH.plus(amount);
  broadcaster.totalVolumeUSD = broadcaster.totalVolumeUSD.plus(amountUSD);
  broadcaster.lastFundedDay = (timestamp / 86400) * 86400;
  broadcaster.save();

  // Update transcoder's fee volume
  let transcoder = createOrLoadTranscoder(
    event.params.recipient.toHex(),
    timestamp
  );
  // BondingManager.updateTranscoderWithFees() only runs, and so only moves
  // lastFeeRound, when an amount was actually transferred
  if (amount.gt(ZERO_BD)) {
    transcoder.lastFeeRound = round.id;
  }
  transcoder.totalVolumeETH = transcoder.totalVolumeETH.plus(amount);
  transcoder.totalVolumeUSD = transcoder.totalVolumeUSD.plus(amountUSD);

  // Update total protocol fee volume
  protocol.totalVolumeETH = protocol.totalVolumeETH.plus(amount);
  protocol.totalVolumeUSD = protocol.totalVolumeUSD.plus(amountUSD);

  protocol.winningTicketCount = protocol.winningTicketCount + 1;
  protocol.save();

  // update the transcoder pool fees
  let pool = createOrLoadPool(round.id, event.params.recipient.toHex());
  pool.fees = pool.fees.plus(amount);
  pool.save();

  recordProtocolDataPoint(protocol, event.block, amount, amountUSD);

  if (amount.gt(ZERO_BD)) {
    addRecentFeeVolume(transcoder, timestamp, amount);

    // graph-node assigns the id and overwrites the timestamp
    let feeDataPoint = new FeeDataPoint(0);
    feeDataPoint.timestamp = timeseriesTimestamp(event.block);
    feeDataPoint.transcoder = transcoder.id;
    feeDataPoint.broadcaster = broadcaster.id;
    feeDataPoint.volumeETH = amount;
    feeDataPoint.volumeUSD = amountUSD;
    feeDataPoint.save();
  }
  transcoder.save();

  // Update fee volume for this round
  round.volumeETH = round.volumeETH.plus(amount);
  round.volumeUSD = round.volumeUSD.plus(amountUSD);
  round.save();
}

export function winningTicketTransfer(event: WinningTicketTransfer): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  createOrLoadBroadcaster(event.params.sender.toHex());
  createOrLoadTranscoder(
    event.params.recipient.toHex(),
    event.block.timestamp.toI32()
  );
  createOrLoadTransactionFromEvent(event);

  let winningTicketTransferEvent = new WinningTicketTransferEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  winningTicketTransferEvent.transaction = event.transaction.hash.toHex();
  winningTicketTransferEvent.timestamp = event.block.timestamp.toI32();
  winningTicketTransferEvent.round = round.id;
  winningTicketTransferEvent.sender = event.params.sender.toHex();
  winningTicketTransferEvent.recipient = event.params.recipient.toHex();
  winningTicketTransferEvent.amount = convertToDecimal(event.params.amount);
  winningTicketTransferEvent.save();
}

export function depositFunded(event: DepositFunded): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let broadcaster = createOrLoadBroadcaster(event.params.sender.toHex());
  const timestamp = event.block.timestamp.toI32();
  
  // One-time initialization: set to start of day for this timestamp.
  if (broadcaster.firstFundedDay == 0) {
    const startOfDay = (timestamp / 86400) * 86400;
    broadcaster.firstFundedDay = startOfDay;
  }

  broadcaster.deposit = broadcaster.deposit.plus(
    convertToDecimal(event.params.amount)
  );
  broadcaster.save();

  createOrLoadTransactionFromEvent(event);

  let depositFundedEvent = new DepositFundedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  depositFundedEvent.transaction = event.transaction.hash.toHex();
  depositFundedEvent.timestamp = timestamp;
  depositFundedEvent.round = round.id;
  depositFundedEvent.sender = event.params.sender.toHex();
  depositFundedEvent.amount = convertToDecimal(event.params.amount);
  depositFundedEvent.save();
}

export function reserveFunded(event: ReserveFunded): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let broadcaster = createOrLoadBroadcaster(event.params.reserveHolder.toHex());
  const timestamp = event.block.timestamp.toI32();

  // One-time initialization: set to start of day for this timestamp.
  if (broadcaster.firstFundedDay == 0) {
    const startOfDay = (timestamp / 86400) * 86400;
    broadcaster.firstFundedDay = startOfDay;
  }

  broadcaster.reserve = broadcaster.reserve.plus(
    convertToDecimal(event.params.amount)
  );
  broadcaster.save();

  createOrLoadTransactionFromEvent(event);

  let reserveFundedEvent = new ReserveFundedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  reserveFundedEvent.transaction = event.transaction.hash.toHex();
  reserveFundedEvent.timestamp = timestamp;
  reserveFundedEvent.round = round.id;
  reserveFundedEvent.reserveHolder = event.params.reserveHolder.toHex();
  reserveFundedEvent.amount = convertToDecimal(event.params.amount);
  reserveFundedEvent.save();
}

export function reserveClaimed(event: ReserveClaimed): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let broadcaster = createOrLoadBroadcaster(event.params.reserveHolder.toHex());
  broadcaster.reserve = broadcaster.reserve.minus(
    convertToDecimal(event.params.amount)
  );
  broadcaster.save();

  createOrLoadTransactionFromEvent(event);

  let reserveClaimedEvent = new ReserveClaimedEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  reserveClaimedEvent.transaction = event.transaction.hash.toHex();
  reserveClaimedEvent.timestamp = event.block.timestamp.toI32();
  reserveClaimedEvent.round = round.id;
  reserveClaimedEvent.reserveHolder = event.params.reserveHolder.toHex();
  reserveClaimedEvent.claimant = event.params.claimant.toHex();
  reserveClaimedEvent.amount = convertToDecimal(event.params.amount);
  reserveClaimedEvent.save();
}

export function withdrawal(event: Withdrawal): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let broadcaster = createOrLoadBroadcaster(event.params.sender.toHex());
  broadcaster.deposit = ZERO_BD;
  broadcaster.reserve = ZERO_BD;
  broadcaster.save();

  createOrLoadTransactionFromEvent(event);

  let withdrawalEvent = new WithdrawalEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  withdrawalEvent.transaction = event.transaction.hash.toHex();
  withdrawalEvent.timestamp = event.block.timestamp.toI32();
  withdrawalEvent.round = round.id;
  withdrawalEvent.sender = event.params.sender.toHex();
  withdrawalEvent.deposit = convertToDecimal(event.params.deposit);
  withdrawalEvent.reserve = convertToDecimal(event.params.reserve);
  withdrawalEvent.save();
}

export function unlock(event: Unlock): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let broadcaster = createOrLoadBroadcaster(event.params.sender.toHex());
  broadcaster.isUnlocked = true;
  broadcaster.unlockStartRound = event.params.startRound;
  broadcaster.unlockEndRound = event.params.endRound;
  broadcaster.save();

  createOrLoadTransactionFromEvent(event);

  let unlockEvent = new UnlockEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  unlockEvent.transaction = event.transaction.hash.toHex();
  unlockEvent.timestamp = event.block.timestamp.toI32();
  unlockEvent.round = round.id;
  unlockEvent.sender = event.params.sender.toHex();
  unlockEvent.startRound = event.params.startRound;
  unlockEvent.endRound = event.params.endRound;
  unlockEvent.save();
}

export function unlockCancelled(event: UnlockCancelled): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let broadcaster = createOrLoadBroadcaster(event.params.sender.toHex());
  broadcaster.isUnlocked = false;
  broadcaster.save();

  createOrLoadTransactionFromEvent(event);

  let unlockCancelledEvent = new UnlockCancelledEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  unlockCancelledEvent.transaction = event.transaction.hash.toHex();
  unlockCancelledEvent.timestamp = event.block.timestamp.toI32();
  unlockCancelledEvent.round = round.id;
  unlockCancelledEvent.sender = event.params.sender.toHex();
  unlockCancelledEvent.save();
}

export function parameterUpdate(event: ParameterUpdate): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let parameterUpdateEvent = new ParameterUpdateEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  parameterUpdateEvent.transaction = event.transaction.hash.toHex();
  parameterUpdateEvent.timestamp = event.block.timestamp.toI32();
  parameterUpdateEvent.round = round.id;
  parameterUpdateEvent.param = event.params.param;
  parameterUpdateEvent.save();
}

export function setController(event: SetController): void {
  recordSetController(event, event.params.controller);
}
