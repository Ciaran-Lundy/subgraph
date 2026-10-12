import {
  Address,
  BigInt,
  Bytes,
  ethereum,
} from "@graphprotocol/graph-ts";
import { createMockedFunction, newMockEvent } from "matchstick-as";
import {
  BONDING_MANAGER_ADDRESS,
  ROUNDS_MANAGER_ADDRESS,
} from "../utils/addresses";
import {
  Bond,
  Reward,
  TranscoderUpdate,
  TransferBond,
  Unbond,
  Rebond,
} from "../src/types/BondingManager/BondingManager";

export const ROUND_LENGTH = 100;
// L1 block number returned by RoundsManager.blockNum(): round 10
export const L1_BLOCK = 1050;
export const CURRENT_ROUND = "10";

export const bondingManager = Address.fromString(BONDING_MANAGER_ADDRESS);
export const roundsManager = Address.fromString(ROUNDS_MANAGER_ADDRESS);

export function wei(eth: i32): BigInt {
  return BigInt.fromI32(eth).times(BigInt.fromString("1000000000000000000"));
}

export function mockRoundsManager(blockNum: i32 = L1_BLOCK): void {
  createMockedFunction(roundsManager, "blockNum", "blockNum():(uint256)")
    .withArgs([])
    .returns([ethereum.Value.fromI32(blockNum)]);
  createMockedFunction(roundsManager, "roundLength", "roundLength():(uint256)")
    .withArgs([])
    .returns([ethereum.Value.fromI32(ROUND_LENGTH)]);
}

export function mockGetDelegator(
  delegator: Address,
  bondedAmount: BigInt,
  delegate: Address,
  delegatedAmount: BigInt
): void {
  createMockedFunction(
    bondingManager,
    "getDelegator",
    "getDelegator(address):(uint256,uint256,address,uint256,uint256,uint256,uint256)"
  )
    .withArgs([ethereum.Value.fromAddress(delegator)])
    .returns([
      ethereum.Value.fromUnsignedBigInt(bondedAmount),
      ethereum.Value.fromI32(0),
      ethereum.Value.fromAddress(delegate),
      ethereum.Value.fromUnsignedBigInt(delegatedAmount),
      ethereum.Value.fromI32(11),
      ethereum.Value.fromI32(10),
      ethereum.Value.fromI32(0),
    ]);
}

export function mockPendingStake(delegator: Address, stake: BigInt): void {
  createMockedFunction(
    bondingManager,
    "pendingStake",
    "pendingStake(address,uint256):(uint256)"
  )
    .withArgs([
      ethereum.Value.fromAddress(delegator),
      ethereum.Value.fromUnsignedBigInt(BigInt.fromString(CURRENT_ROUND)),
    ])
    .returns([ethereum.Value.fromUnsignedBigInt(stake)]);
}

function param(name: string, value: ethereum.Value): ethereum.EventParam {
  return new ethereum.EventParam(name, value);
}

function address(a: Address): ethereum.Value {
  return ethereum.Value.fromAddress(a);
}

function uint(v: BigInt): ethereum.Value {
  return ethereum.Value.fromUnsignedBigInt(v);
}

function prepare<T extends ethereum.Event>(
  event: T,
  emitter: Address,
  logIndex: i32,
  txHash: string
): T {
  event.address = emitter;
  event.logIndex = BigInt.fromI32(logIndex);
  event.transaction.hash = Bytes.fromHexString(txHash);
  event.parameters = new Array();
  return event;
}

export const TX_A =
  "0xaaaa000000000000000000000000000000000000000000000000000000000001";
export const TX_B =
  "0xbbbb000000000000000000000000000000000000000000000000000000000002";

export function createBond(
  newDelegate: Address,
  oldDelegate: Address,
  delegator: Address,
  additionalAmount: BigInt,
  bondedAmount: BigInt,
  logIndex: i32 = 1
): Bond {
  let event = prepare(changetype<Bond>(newMockEvent()), bondingManager, logIndex, TX_A);
  event.parameters.push(param("newDelegate", address(newDelegate)));
  event.parameters.push(param("oldDelegate", address(oldDelegate)));
  event.parameters.push(param("delegator", address(delegator)));
  event.parameters.push(param("additionalAmount", uint(additionalAmount)));
  event.parameters.push(param("bondedAmount", uint(bondedAmount)));
  return event;
}

export function createUnbond(
  delegate: Address,
  delegator: Address,
  unbondingLockId: i32,
  amount: BigInt,
  withdrawRound: i32 = 20,
  logIndex: i32 = 2
): Unbond {
  let event = prepare(changetype<Unbond>(newMockEvent()), bondingManager, logIndex, TX_A);
  event.parameters.push(param("delegate", address(delegate)));
  event.parameters.push(param("delegator", address(delegator)));
  event.parameters.push(param("unbondingLockId", ethereum.Value.fromI32(unbondingLockId)));
  event.parameters.push(param("amount", uint(amount)));
  event.parameters.push(param("withdrawRound", ethereum.Value.fromI32(withdrawRound)));
  return event;
}

export function createRebond(
  delegate: Address,
  delegator: Address,
  unbondingLockId: i32,
  amount: BigInt,
  logIndex: i32 = 3
): Rebond {
  let event = prepare(changetype<Rebond>(newMockEvent()), bondingManager, logIndex, TX_A);
  event.parameters.push(param("delegate", address(delegate)));
  event.parameters.push(param("delegator", address(delegator)));
  event.parameters.push(param("unbondingLockId", ethereum.Value.fromI32(unbondingLockId)));
  event.parameters.push(param("amount", uint(amount)));
  return event;
}

export function createReward(transcoder: Address, amount: BigInt): Reward {
  let event = prepare(changetype<Reward>(newMockEvent()), bondingManager, 4, TX_A);
  event.parameters.push(param("transcoder", address(transcoder)));
  event.parameters.push(param("amount", uint(amount)));
  return event;
}

export function createTransferBond(
  oldDelegator: Address,
  newDelegator: Address,
  oldUnbondingLockId: i32,
  newUnbondingLockId: i32,
  amount: BigInt
): TransferBond {
  let event = prepare(changetype<TransferBond>(newMockEvent()), bondingManager, 5, TX_A);
  event.parameters.push(param("oldDelegator", address(oldDelegator)));
  event.parameters.push(param("newDelegator", address(newDelegator)));
  event.parameters.push(param("oldUnbondingLockId", ethereum.Value.fromI32(oldUnbondingLockId)));
  event.parameters.push(param("newUnbondingLockId", ethereum.Value.fromI32(newUnbondingLockId)));
  event.parameters.push(param("amount", uint(amount)));
  return event;
}

export function createTranscoderUpdate(
  transcoder: Address,
  rewardCut: i32,
  feeShare: i32,
  timestamp: i32,
  logIndex: i32 = 6
): TranscoderUpdate {
  let event = prepare(changetype<TranscoderUpdate>(newMockEvent()), bondingManager, logIndex, TX_A);
  event.block.timestamp = BigInt.fromI32(timestamp);
  event.parameters.push(param("transcoder", address(transcoder)));
  event.parameters.push(param("rewardCut", ethereum.Value.fromI32(rewardCut)));
  event.parameters.push(param("feeShare", ethereum.Value.fromI32(feeShare)));
  return event;
}
