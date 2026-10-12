import {
  convertToDecimal,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  getBlockNum,
  makeEventId,
} from "../../utils/helpers";
import {
  Minter,
  ParameterUpdate,
  SetController,
  SetCurrentRewardTokens,
} from "../types/Minter/Minter";
import {
  ParameterUpdateEvent,
  SetCurrentRewardTokensEvent,
} from "../types/schema";
import { recordSetController } from "./common";

export function setCurrentRewardTokens(event: SetCurrentRewardTokens): void {
  let minter = Minter.bind(event.address);
  let protocol = createOrLoadProtocol();

  // The variables targetBondingRate, inflationChange, and inflation are
  // initially set inside the Minter's constructor, however constructors are
  // currently disallowed in call handlers so we'll set them in here for now
  protocol.targetBondingRate = minter.targetBondingRate();
  protocol.inflationChange = minter.inflationChange();
  protocol.inflation = minter.inflation();
  protocol.save();

  let round = createOrLoadRound(

    protocol,

    getBlockNum(protocol, event.block)

  );

  round.mintableTokens = convertToDecimal(event.params.currentMintableTokens);
  round.save();

  createOrLoadTransactionFromEvent(event);
  let setCurrentRewardTokensEvent = new SetCurrentRewardTokensEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  setCurrentRewardTokensEvent.transaction = event.transaction.hash;
  setCurrentRewardTokensEvent.timestamp = event.block.timestamp.toI32();
  setCurrentRewardTokensEvent.round = round.id;
  setCurrentRewardTokensEvent.currentMintableTokens = convertToDecimal(
    event.params.currentMintableTokens
  );
  setCurrentRewardTokensEvent.currentInflation = event.params.currentInflation;
  setCurrentRewardTokensEvent.save();
}

export function parameterUpdate(event: ParameterUpdate): void {
  let minter = Minter.bind(event.address);
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  if (event.params.param == "targetBondingRate") {
    protocol.targetBondingRate = minter.targetBondingRate();
  }

  if (event.params.param == "inflationChange") {
    protocol.inflationChange = minter.inflationChange();
  }

  protocol.save();

  createOrLoadTransactionFromEvent(event);
  let parameterUpdateEvent = new ParameterUpdateEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  parameterUpdateEvent.transaction = event.transaction.hash;
  parameterUpdateEvent.timestamp = event.block.timestamp.toI32();
  parameterUpdateEvent.round = round.id;
  parameterUpdateEvent.param = event.params.param;
  parameterUpdateEvent.save();
}

export function setController(event: SetController): void {
  recordSetController(event, event.params.controller);
}
