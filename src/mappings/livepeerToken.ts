import { Address, log } from "@graphprotocol/graph-ts";
import {
  convertToDecimal,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  getBlockNum,
  makeEventId,
  recordProtocolDataPoint,
  ZERO_BD,
} from "../../utils/helpers";
import { MINTER_ADDRESS } from "../../utils/addresses";
import { Burn, Mint } from "../types/LivepeerToken/LivepeerToken";
import { Minter } from "../types/Minter/Minter";
import { BurnEvent, MintEvent } from "../types/schema";

export function mint(event: Mint): void {
  let protocol = createOrLoadProtocol();
  let amount = convertToDecimal(event.params.amount);
  let minter = Minter.bind(Address.fromString(MINTER_ADDRESS));
  let callResult = minter.try_getGlobalTotalSupply();
  let totalSupply = ZERO_BD;

  // getGlobalTotalSupply will revert until block #6253359 when the new minter was deployed
  if (callResult.reverted) {
    log.info("getGlobalTotalSupply reverted", []);
    totalSupply = protocol.totalSupply.plus(
      convertToDecimal(event.params.amount)
    );
  } else {
    totalSupply = convertToDecimal(callResult.value);
  }

  protocol.totalSupply = totalSupply;

  // check both operands are greater than 0 to avoid divide by zero
  if (protocol.totalActiveStake.gt(ZERO_BD) && totalSupply.gt(ZERO_BD)) {
    protocol.participationRate = protocol.totalActiveStake.div(totalSupply);
  }

  let round = createOrLoadRound(

    protocol,

    getBlockNum(protocol, event.block)

  );
  round.totalSupply = totalSupply;
  round.participationRate = protocol.participationRate;
  round.save();

  protocol.save();
  recordProtocolDataPoint(protocol, event.block, ZERO_BD, ZERO_BD);

  createOrLoadTransactionFromEvent(event);

  let mintEvent = new MintEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  mintEvent.transaction = event.transaction.hash.toHex();
  mintEvent.timestamp = event.block.timestamp.toI32();
  mintEvent.round = round.id;
  mintEvent.to = event.params.to.toHex();
  mintEvent.amount = amount;
  mintEvent.save();
}

export function burn(event: Burn): void {
  let protocol = createOrLoadProtocol();
  let round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  let value = convertToDecimal(event.params.value);
  let minter = Minter.bind(Address.fromString(MINTER_ADDRESS));

  let callResult = minter.try_getGlobalTotalSupply();
  let totalSupply = ZERO_BD;

  // getGlobalTotalSupply will revert until block #6253359 when the new minter was deployed
  if (callResult.reverted) {
    log.info("getGlobalTotalSupply reverted", []);
    totalSupply = protocol.totalSupply.minus(
      convertToDecimal(event.params.value)
    );
  } else {
    totalSupply = convertToDecimal(callResult.value);
  }

  protocol.totalSupply = totalSupply;

  if (protocol.totalActiveStake.gt(ZERO_BD) && totalSupply.gt(ZERO_BD)) {
    protocol.participationRate = protocol.totalActiveStake.div(totalSupply);
  }

  round.totalSupply = totalSupply;
  round.participationRate = protocol.participationRate;
  round.save();

  protocol.save();
  recordProtocolDataPoint(protocol, event.block, ZERO_BD, ZERO_BD);

  createOrLoadTransactionFromEvent(event);

  let burnEvent = new BurnEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  burnEvent.transaction = event.transaction.hash.toHex();
  burnEvent.timestamp = event.block.timestamp.toI32();
  burnEvent.round = round.id;
  burnEvent.value = value;
  burnEvent.save();
}
