import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import { createMockedFunction } from "matchstick-as/assembly/index";
import { BONDING_MANAGER, MINTER, ROUNDS_MANAGER } from "./constants";

function uint(value: BigInt): ethereum.Value {
  return ethereum.Value.fromUnsignedBigInt(value);
}

function address(value: Address): ethereum.Value {
  return ethereum.Value.fromAddress(value);
}

// ---------------------------------------------------------------------------
// RoundsManager
// ---------------------------------------------------------------------------

export function mockBlockNum(blockNum: BigInt): void {
  createMockedFunction(ROUNDS_MANAGER, "blockNum", "blockNum():(uint256)").returns(
    [uint(blockNum)]
  );
}

export function mockBlockNumReverts(): void {
  createMockedFunction(ROUNDS_MANAGER, "blockNum", "blockNum():(uint256)").reverts();
}

export function mockRoundLength(
  roundLength: BigInt,
  roundsManager: Address = ROUNDS_MANAGER
): void {
  createMockedFunction(
    roundsManager,
    "roundLength",
    "roundLength():(uint256)"
  ).returns([uint(roundLength)]);
}

export function mockRoundLengthReverts(): void {
  createMockedFunction(
    ROUNDS_MANAGER,
    "roundLength",
    "roundLength():(uint256)"
  ).reverts();
}

export function mockCurrentRound(round: BigInt): void {
  createMockedFunction(
    ROUNDS_MANAGER,
    "currentRound",
    "currentRound():(uint256)"
  ).returns([uint(round)]);
}

export function mockLastRoundLengthUpdateStartBlock(block: BigInt): void {
  createMockedFunction(
    ROUNDS_MANAGER,
    "lastRoundLengthUpdateStartBlock",
    "lastRoundLengthUpdateStartBlock():(uint256)"
  ).returns([uint(block)]);
}

export function mockLastRoundLengthUpdateRound(round: BigInt): void {
  createMockedFunction(
    ROUNDS_MANAGER,
    "lastRoundLengthUpdateRound",
    "lastRoundLengthUpdateRound():(uint256)"
  ).returns([uint(round)]);
}

export function mockRoundLockAmount(amount: BigInt): void {
  createMockedFunction(
    ROUNDS_MANAGER,
    "roundLockAmount",
    "roundLockAmount():(uint256)"
  ).returns([uint(amount)]);
}

export function mockRoundLockAmountReverts(): void {
  createMockedFunction(
    ROUNDS_MANAGER,
    "roundLockAmount",
    "roundLockAmount():(uint256)"
  ).reverts();
}

// ---------------------------------------------------------------------------
// BondingManager
// ---------------------------------------------------------------------------

// Mirrors BondingManager.getDelegator's return tuple. Only the fields the
// mappings read are parameters; the rest are fixed at zero.
export function mockGetDelegator(
  delegator: Address,
  bondedAmount: BigInt,
  fees: BigInt,
  delegateAddress: Address,
  delegatedAmount: BigInt,
  startRound: BigInt
): void {
  createMockedFunction(
    BONDING_MANAGER,
    "getDelegator",
    "getDelegator(address):(uint256,uint256,address,uint256,uint256,uint256,uint256)"
  )
    .withArgs([address(delegator)])
    .returns([
      uint(bondedAmount),
      uint(fees),
      address(delegateAddress),
      uint(delegatedAmount),
      uint(startRound),
      uint(BigInt.zero()),
      uint(BigInt.zero()),
    ]);
}

export function mockGetDelegatorUnbondingLock(
  delegator: Address,
  unbondingLockId: BigInt,
  amount: BigInt,
  withdrawRound: BigInt
): void {
  createMockedFunction(
    BONDING_MANAGER,
    "getDelegatorUnbondingLock",
    "getDelegatorUnbondingLock(address,uint256):(uint256,uint256)"
  )
    .withArgs([address(delegator), uint(unbondingLockId)])
    .returns([uint(amount), uint(withdrawRound)]);
}

export function mockPendingStake(
  delegator: Address,
  round: BigInt,
  stake: BigInt
): void {
  createMockedFunction(
    BONDING_MANAGER,
    "pendingStake",
    "pendingStake(address,uint256):(uint256)"
  )
    .withArgs([address(delegator), uint(round)])
    .returns([uint(stake)]);
}

export function mockPendingStakeReverts(delegator: Address, round: BigInt): void {
  createMockedFunction(
    BONDING_MANAGER,
    "pendingStake",
    "pendingStake(address,uint256):(uint256)"
  )
    .withArgs([address(delegator), uint(round)])
    .reverts();
}

export function mockFirstTranscoderInPool(transcoder: Address): void {
  createMockedFunction(
    BONDING_MANAGER,
    "getFirstTranscoderInPool",
    "getFirstTranscoderInPool():(address)"
  ).returns([address(transcoder)]);
}

export function mockFirstTranscoderInPoolReverts(): void {
  createMockedFunction(
    BONDING_MANAGER,
    "getFirstTranscoderInPool",
    "getFirstTranscoderInPool():(address)"
  ).reverts();
}

export function mockNextTranscoderInPool(
  transcoder: Address,
  next: Address
): void {
  createMockedFunction(
    BONDING_MANAGER,
    "getNextTranscoderInPool",
    "getNextTranscoderInPool(address):(address)"
  )
    .withArgs([address(transcoder)])
    .returns([address(next)]);
}

export function mockNextTranscoderInPoolReverts(transcoder: Address): void {
  createMockedFunction(
    BONDING_MANAGER,
    "getNextTranscoderInPool",
    "getNextTranscoderInPool(address):(address)"
  )
    .withArgs([address(transcoder)])
    .reverts();
}

export function mockTotalBonded(totalBonded: BigInt): void {
  createMockedFunction(
    BONDING_MANAGER,
    "getTotalBonded",
    "getTotalBonded():(uint256)"
  ).returns([uint(totalBonded)]);
}

export function mockTotalBondedReverts(): void {
  createMockedFunction(
    BONDING_MANAGER,
    "getTotalBonded",
    "getTotalBonded():(uint256)"
  ).reverts();
}

export function mockUnbondingPeriod(period: BigInt): void {
  createMockedFunction(
    BONDING_MANAGER,
    "unbondingPeriod",
    "unbondingPeriod():(uint64)"
  ).returns([uint(period)]);
}

export function mockUnbondingPeriodReverts(): void {
  createMockedFunction(
    BONDING_MANAGER,
    "unbondingPeriod",
    "unbondingPeriod():(uint64)"
  ).reverts();
}

export function mockTranscoderPoolMaxSize(size: BigInt): void {
  createMockedFunction(
    BONDING_MANAGER,
    "getTranscoderPoolMaxSize",
    "getTranscoderPoolMaxSize():(uint256)"
  ).returns([uint(size)]);
}

export function mockTranscoderPoolMaxSizeReverts(): void {
  createMockedFunction(
    BONDING_MANAGER,
    "getTranscoderPoolMaxSize",
    "getTranscoderPoolMaxSize():(uint256)"
  ).reverts();
}

// ---------------------------------------------------------------------------
// Minter
// ---------------------------------------------------------------------------

export function mockGlobalTotalSupply(totalSupply: BigInt): void {
  createMockedFunction(
    MINTER,
    "getGlobalTotalSupply",
    "getGlobalTotalSupply():(uint256)"
  ).returns([uint(totalSupply)]);
}

export function mockGlobalTotalSupplyReverts(): void {
  createMockedFunction(
    MINTER,
    "getGlobalTotalSupply",
    "getGlobalTotalSupply():(uint256)"
  ).reverts();
}

export function mockTargetBondingRate(rate: BigInt): void {
  createMockedFunction(
    MINTER,
    "targetBondingRate",
    "targetBondingRate():(uint256)"
  ).returns([uint(rate)]);
}

export function mockTargetBondingRateReverts(): void {
  createMockedFunction(
    MINTER,
    "targetBondingRate",
    "targetBondingRate():(uint256)"
  ).reverts();
}

export function mockInflationChange(change: BigInt): void {
  createMockedFunction(
    MINTER,
    "inflationChange",
    "inflationChange():(uint256)"
  ).returns([uint(change)]);
}

export function mockInflationChangeReverts(): void {
  createMockedFunction(
    MINTER,
    "inflationChange",
    "inflationChange():(uint256)"
  ).reverts();
}

export function mockInflation(inflation: BigInt): void {
  createMockedFunction(MINTER, "inflation", "inflation():(uint256)").returns([
    uint(inflation),
  ]);
}

// ---------------------------------------------------------------------------
// Uniswap V3 pools
// ---------------------------------------------------------------------------

// sqrtPriceX96 = 2^96 * sqrt(price), so 2^96 encodes a price of exactly 1 and
// 2^97 a price of exactly 4. Only sqrtPriceX96 is read by the mappings.
export function mockSlot0(pool: Address, sqrtPriceX96: BigInt): void {
  createMockedFunction(
    pool,
    "slot0",
    "slot0():(uint160,int24,uint16,uint16,uint16,uint8,bool)"
  ).returns([
    uint(sqrtPriceX96),
    ethereum.Value.fromI32(0),
    uint(BigInt.zero()),
    uint(BigInt.zero()),
    uint(BigInt.zero()),
    uint(BigInt.zero()),
    ethereum.Value.fromBoolean(true),
  ]);
}

export function mockSlot0Reverts(pool: Address): void {
  createMockedFunction(
    pool,
    "slot0",
    "slot0():(uint160,int24,uint16,uint16,uint16,uint8,bool)"
  ).reverts();
}

export function sqrtPriceX96ForPrice(sqrtPrice: i32): BigInt {
  return BigInt.fromI32(2).pow(96).times(BigInt.fromI32(sqrtPrice));
}
