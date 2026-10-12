import { Address, BigDecimal, BigInt, log } from "@graphprotocol/graph-ts";
import {
  convertToDecimal,
  createOrLoadPool,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  createOrLoadTranscoder,
  createRound,
  EMPTY_ADDRESS,
  getBlockNum,
  getLptPriceEth,
  makeEventId,
  ONE_BD,
  ONE_BI,
  PERC_DIVISOR,
  ZERO_BD,
  recordProtocolDataPoint,
  updateRollingVolumes,
  ZERO_BI,
} from "../../utils/helpers";
import { BONDING_MANAGER_ADDRESS } from "../../utils/addresses";
import { BondingManager } from "../types/BondingManager/BondingManager";
// Import event types from the registrar contract ABIs
import {
  NewRound,
  ParameterUpdate,
  RoundsManager,
} from "../types/RoundsManager/RoundsManager";
// Import entity types generated from the GraphQL schema
import {
  NewRoundEvent,
  ParameterUpdateEvent,
  Transcoder,
} from "../types/schema";

// Handler for NewRound events
export function newRound(event: NewRound): void {
  let bondingManager = BondingManager.bind(
    Address.fromString(BONDING_MANAGER_ADDRESS)
  );
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let currentTranscoder = EMPTY_ADDRESS;
  let totalActiveStake = protocol.totalActiveStake;
  let transcoder: Transcoder | null = null;

  // An empty pool returns the zero address rather than reverting, so a revert
  // here means the eth_call itself failed.
  let callResult = bondingManager.try_getFirstTranscoderInPool();
  if (callResult.reverted) {
    log.warning(
      "newRound: getFirstTranscoderInPool reverted in round {}, skipping pool walk",
      [round.id]
    );
  } else {
    currentTranscoder = callResult.value;
    transcoder = createOrLoadTranscoder(
      currentTranscoder,
      event.block.timestamp.toI32()
    );
  }

  // On revert keep the previous total rather than zeroing it
  let getTotalBondedCallResult = bondingManager.try_getTotalBonded();
  if (getTotalBondedCallResult.reverted) {
    if (protocol.delegatorsCount.gt(ZERO_BI)) {
      log.warning(
        "newRound: getTotalBonded reverted in round {} with {} delegators bonded",
        [round.id, protocol.delegatorsCount.toString()]
      );
    }
  } else {
    totalActiveStake = convertToDecimal(getTotalBondedCallResult.value);
  }

  round.startTimestamp = event.block.timestamp.toI32();
  round.initialized = true;
  round.totalActiveStake = totalActiveStake;
  round.save();

  // Activate all transcoders pending activation
  let pendingActivation = protocol.pendingActivation;
  if (pendingActivation.length) {
    for (let index = 0; index < pendingActivation.length; index++) {
      let t = createOrLoadTranscoder(
        pendingActivation[index],
        event.block.timestamp.toI32()
      );
      t.active = true;
      t.save();
    }
    protocol.pendingActivation = [];
  }

  // Deactivate all transcoders pending deactivation
  let pendingDeactivation = protocol.pendingDeactivation;
  if (pendingDeactivation.length) {
    for (let index = 0; index < pendingDeactivation.length; index++) {
      let t = createOrLoadTranscoder(
        pendingDeactivation[index],
        event.block.timestamp.toI32()
      );
      t.active = false;
      t.save();
    }
    protocol.pendingDeactivation = [];
  }

  // Iterate over all active transcoders
  while (EMPTY_ADDRESS.toHex() != currentTranscoder.toHex()) {
    // create a unique "pool" for each active transcoder. If a transcoder calls
    // reward() for a given round, we store its reward tokens inside this Pool
    // entry in a field called "rewardTokens". If "rewardTokens" is null for a
    // given transcoder and round then we know the transcoder failed to call reward()
    createOrLoadPool(round.id, currentTranscoder);

    // Refresh the 30/60/90 day volumes so they decay for transcoders that
    // stopped earning fees
    transcoder = Transcoder.load(currentTranscoder);
    if (transcoder) {
      updateRollingVolumes(transcoder, event.block.timestamp.toI32());
      transcoder.save();
    }

    let nextResult = bondingManager.try_getNextTranscoderInPool(
      currentTranscoder
    );
    if (nextResult.reverted) {
      log.error(
        "newRound: getNextTranscoderInPool reverted after {} in round {}, stopping pool walk",
        [currentTranscoder.toHex(), round.id]
      );
      break;
    }
    currentTranscoder = nextResult.value;
  }

  // Keep the previous round's price if it could not be read
  let lptPriceEth = getLptPriceEth();
  if (lptPriceEth !== null) {
    protocol.lptPriceEth = lptPriceEth as BigDecimal;
  }
  protocol.lastInitializedRound = round.id;
  protocol.totalActiveStake = totalActiveStake;
  protocol.currentRound = round.id;

  if (
    protocol.totalActiveStake.gt(ZERO_BD) &&
    protocol.totalSupply.gt(ZERO_BD)
  ) {
    protocol.participationRate = protocol.totalActiveStake.div(
      protocol.totalSupply
    );
    round.participationRate = protocol.participationRate;
    round.delegatorsCount = protocol.delegatorsCount;
    round.inflation = protocol.inflation;
    round.numActiveTranscoders = protocol.numActiveTranscoders;
    round.activeTranscoderCount = protocol.activeTranscoderCount;
  }

  protocol.save();
  round.save();
  recordProtocolDataPoint(protocol, event.block, ZERO_BD, ZERO_BD);

  createOrLoadTransactionFromEvent(event);

  let newRoundEvent = new NewRoundEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  newRoundEvent.transaction = event.transaction.hash;
  newRoundEvent.timestamp = event.block.timestamp.toI32();
  newRoundEvent.round = round.id;
  newRoundEvent.blockHash = event.params.blockHash.toHexString();
  newRoundEvent.save();
}

export function parameterUpdate(event: ParameterUpdate): void {
  let roundsManager = RoundsManager.bind(event.address);
  let protocol = createOrLoadProtocol();
  let currentRound = roundsManager.currentRound();

  if (event.params.param == "roundLength") {
    let roundLength = roundsManager.roundLength();
    let lastRoundLengthUpdateStartBlock =
      roundsManager.lastRoundLengthUpdateStartBlock();
    let lastRoundLengthUpdateRound = roundsManager.lastRoundLengthUpdateRound();

    if (protocol.roundLength.toI32() == 0) {
      createRound(
        protocol,
        getBlockNum(protocol, event.block),
        roundLength,
        currentRound
      );
    }
    protocol.roundLength = roundLength;
    protocol.lastRoundLengthUpdateStartBlock = lastRoundLengthUpdateStartBlock;
    protocol.lastRoundLengthUpdateRound = lastRoundLengthUpdateRound.toString();
    protocol.currentRound = currentRound.toString();
  }

  if (event.params.param == "roundLockAmount") {
    protocol.roundLockAmount = roundsManager.roundLockAmount();
    protocol.lockPeriod = roundsManager
      .roundLength()
      .times(roundsManager.roundLockAmount())
      .div(BigInt.fromI32(PERC_DIVISOR));
  }

  protocol.save();

  createOrLoadTransactionFromEvent(event);

  let parameterUpdateEvent = new ParameterUpdateEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  parameterUpdateEvent.transaction = event.transaction.hash;
  parameterUpdateEvent.timestamp = event.block.timestamp.toI32();
  parameterUpdateEvent.round = currentRound.toString();
  parameterUpdateEvent.param = event.params.param;
  parameterUpdateEvent.save();
}
