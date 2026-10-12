import {
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  getBlockNum,
  makeEventId
} from "../../utils/helpers";
import {
  Pause,
  SetContractInfo,
  Unpause,
} from "../types/Controller/Controller";
import {
  PauseEvent,
  SetContractInfoEvent,
  UnpauseEvent,
} from "../types/schema";

export function pause(event: Pause): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  protocol.paused = true;
  protocol.save();

  createOrLoadTransactionFromEvent(event);

  let pauseEvent = new PauseEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  pauseEvent.transaction = event.transaction.hash;
  pauseEvent.timestamp = event.block.timestamp.toI32();
  pauseEvent.round = round.id;
  pauseEvent.save();
}

export function unpause(event: Unpause): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  protocol.paused = false;
  protocol.save();

  createOrLoadTransactionFromEvent(event);

  let unpauseEvent = new UnpauseEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  unpauseEvent.transaction = event.transaction.hash;
  unpauseEvent.timestamp = event.block.timestamp.toI32();
  unpauseEvent.round = round.id;
  unpauseEvent.save();
}

// Runs during protocol deployment, so it must not touch Protocol or Round:
// both make RoundsManager calls that revert before it is deployed
export function setContractInfo(event: SetContractInfo): void {
  createOrLoadTransactionFromEvent(event);

  let setContractInfoEvent = new SetContractInfoEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  setContractInfoEvent.transaction = event.transaction.hash;
  setContractInfoEvent.timestamp = event.block.timestamp.toI32();
  setContractInfoEvent.blockNumber = event.block.number;
  setContractInfoEvent.contractId = event.params.id;
  setContractInfoEvent.contractAddress = event.params.contractAddress.toHex();
  setContractInfoEvent.gitCommitHash = event.params.gitCommitHash;
  setContractInfoEvent.save();
}
