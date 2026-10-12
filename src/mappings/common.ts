import { Address, ethereum } from "@graphprotocol/graph-ts";
import {
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  getBlockNum,
  makeEventId,
} from "../../utils/helpers";
import { SetControllerEvent } from "../types/schema";

// Shared body for the SetController handlers on every managed contract
export function recordSetController(
  event: ethereum.Event,
  controller: Address
): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );

  createOrLoadTransactionFromEvent(event);

  let setControllerEvent = new SetControllerEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  setControllerEvent.transaction = event.transaction.hash;
  setControllerEvent.timestamp = event.block.timestamp.toI32();
  setControllerEvent.round = round.id;
  setControllerEvent.contractAddress = event.address.toHex();
  setControllerEvent.controller = controller.toHex();
  setControllerEvent.save();
}
