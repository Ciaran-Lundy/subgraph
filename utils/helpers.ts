import {
  Address,
  BigDecimal,
  BigInt,
  Bytes,
  ethereum,
  log,
} from "@graphprotocol/graph-ts";
import { RoundsManager } from "../src/types/RoundsManager/RoundsManager";
import {
  Broadcaster,
  Delegator,
  LivepeerAccount,
  Pool,
  Protocol,
  ProtocolDataPoint,
  Round,
  Transaction,
  Transcoder,
  Vote,
} from "../src/types/schema";
import { UniswapV3Pool } from "../src/types/TicketBroker/UniswapV3Pool";
import {
  ROUNDS_MANAGER_ADDRESS,
  UNISWAP_V3_DAI_ETH_POOL_ADDRESS,
  UNISWAP_V3_LPT_ETH_POOL_ADDRESS,
} from "./addresses";

let x = BigInt.fromI32(2);
let y = 255 as u8;
let z = BigInt.fromI32(1);

export let MAXIMUM_VALUE_UINT256: BigInt = x.pow(y).minus(z);
export let EMPTY_ADDRESS = Address.fromString(
  "0000000000000000000000000000000000000000"
);
export let PERC_DIVISOR = 1000000;

export let ZERO_BI = BigInt.fromI32(0);
export let ONE_BI = BigInt.fromI32(1);
export let ZERO_BD = BigDecimal.fromString("0");
export let ONE_BD = BigDecimal.fromString("1");
export let BI_18 = BigInt.fromI32(18);

// Make a number the specified number of digits
export function leftPad(str: string, size: i32): string {
  while (str.length < size) {
    str = "0" + str;
  }
  return str;
}

// Make a derived pool ID from a transcoder address
export function makePoolId(transcoderAddress: Bytes, roundId: string): string {
  return leftPad(roundId, 10) + "-" + transcoderAddress.toHex();
}

export function createOrLoadPool(
  roundId: string,
  transcoderAddress: Bytes
): Pool {
  let poolId = makePoolId(transcoderAddress, roundId);
  let pool = Pool.load(poolId);

  if (pool == null) {
    pool = new Pool(poolId);
    pool.round = roundId;
    pool.delegate = transcoderAddress;
    pool.fees = ZERO_BD;
    let transcoder = Transcoder.load(transcoderAddress);

    if (transcoder) {
      pool.totalStake = transcoder.totalStake;
      pool.rewardCut = transcoder.rewardCut;
      pool.feeShare = transcoder.feeShare;
    } else {
      // Failsafe: the Transcoder should exist, but default the non-nullable
      // fields if it is missing so save() cannot abort.
      pool.totalStake = ZERO_BD;
      pool.rewardCut = ZERO_BI;
      pool.feeShare = ZERO_BI;
    }
    pool.save();
  }
  return pool;
}

// Make a derived share ID from a delegator address
export function makeShareId(delegatorAddress: string, roundId: string): string {
  return leftPad(roundId, 10) + "-" + delegatorAddress;
}

// Make a vote id
export function makeVoteId(
  delegatorAddress: Bytes,
  pollAddress: Bytes
): string {
  return delegatorAddress.toHex() + "-" + pollAddress.toHex();
}

// Make a derived unlocking ID from a delegator address
export function makeUnbondingLockId(
  delegatorAddress: Address,
  unbondingLockId: BigInt
): string {
  return (
    leftPad(unbondingLockId.toString(), 10) + "-" + delegatorAddress.toHex()
  );
}

export function makeEventId(hash: Bytes, index: BigInt): string {
  return hash.toHex() + "-" + index.toString();
}

export function percOfWithDenom(
  _amount: BigInt,
  _fracNum: BigInt,
  _fracDenom: BigInt
): BigInt {
  return _amount
    .times(percPoints(_fracNum, _fracDenom))
    .div(BigInt.fromI32(PERC_DIVISOR));
}

export function percOf(_amount: BigInt, _fracNum: BigInt): BigInt {
  return _amount.times(_fracNum).div(BigInt.fromI32(PERC_DIVISOR));
}

export function percPoints(_fracNum: BigInt, _fracDenom: BigInt): BigInt {
  return _fracNum.times(BigInt.fromI32(PERC_DIVISOR)).div(_fracDenom);
}

export function exponentToBigDecimal(decimals: BigInt): BigDecimal {
  let bd = BigDecimal.fromString("1");
  for (let i = ZERO_BI; i.lt(decimals); i = i.plus(ONE_BI)) {
    bd = bd.times(BigDecimal.fromString("10"));
  }
  return bd;
}

export function convertToDecimal(eth: BigInt): BigDecimal {
  return eth.toBigDecimal().div(exponentToBigDecimal(BI_18));
}

export function createOrLoadTransactionFromEvent<T extends ethereum.Event>(
  event: T
): Transaction {
  let tx = Transaction.load(event.transaction.hash);
  if (tx == null) {
    tx = new Transaction(event.transaction.hash);

    tx.blockNumber = event.block.number;
    // Every handler declares `receipt: true`; fall back to the gas limit
    // (the previous behaviour) only if a receipt is unavailable
    let receipt = event.receipt;
    tx.gasUsed = receipt ? receipt.gasUsed : event.transaction.gasLimit;
    tx.gasPrice = event.transaction.gasPrice;
    tx.timestamp = event.block.timestamp.toI32();
    tx.from = event.transaction.from.toHex();

    if (event.transaction.to) {
      tx.to = event.transaction.to!.toHex();
    }

    tx.save();
  }
  return tx;
}

export function createOrLoadProtocol(): Protocol {
  let protocol = Protocol.load("0");
  if (protocol == null) {
    protocol = new Protocol("0");
    protocol.paused = false;
    protocol.currentRound = ZERO_BI.toString();
    protocol.lastInitializedRound = ZERO_BI.toString();
    protocol.lastRoundLengthUpdateRound = ZERO_BI.toString();
    protocol.inflation = ZERO_BI;
    protocol.inflationChange = ZERO_BI;
    protocol.lastRoundLengthUpdateStartBlock = ZERO_BI;
    protocol.lockPeriod = ZERO_BI;
    let roundsManager = RoundsManager.bind(
      Address.fromString(ROUNDS_MANAGER_ADDRESS)
    );
    protocol.roundLength = roundsManager.roundLength();
    protocol.roundLockAmount = ZERO_BI;
    protocol.targetBondingRate = ZERO_BI;
    protocol.totalActiveStake = ZERO_BD;
    protocol.totalSupply = ZERO_BD;
    protocol.participationRate = ZERO_BD;
    protocol.totalVolumeETH = ZERO_BD;
    protocol.totalVolumeUSD = ZERO_BD;
    protocol.unbondingPeriod = ZERO_BI;
    protocol.numActiveTranscoders = ZERO_BI;
    protocol.activeTranscoderCount = ZERO_BI;
    protocol.winningTicketCount = 0;
    protocol.roundCount = 0;
    protocol.lptPriceEth = ZERO_BD;
    protocol.ethPriceUsd = ZERO_BD;
    protocol.ethPriceCachedAtBlock = ZERO_BI;
    protocol.l1BlockNum = ZERO_BI;
    protocol.l1BlockCachedAtL2Block = ZERO_BI;
    protocol.latestPollEndBlock = ZERO_BI;

    // Counted exactly from bonded-state transitions (see updateDelegatorCounts)
    protocol.delegatorsCount = ZERO_BI;

    protocol.pendingActivation = [];
    protocol.pendingDeactivation = [];
    protocol.save();
  }

  return protocol;
}

export function createOrLoadBroadcaster(id: Bytes): Broadcaster {
  let broadcaster = Broadcaster.load(id);

  if (broadcaster == null) {
    broadcaster = new Broadcaster(id);
    broadcaster.deposit = ZERO_BD;
    broadcaster.reserve = ZERO_BD;
    broadcaster.totalVolumeETH = ZERO_BD;
    broadcaster.totalVolumeUSD = ZERO_BD;
    broadcaster.firstFundedDay = 0;
    broadcaster.lastFundedDay = 0;
    broadcaster.isUnlocked = false;

    broadcaster.save();
  } 
  
  return broadcaster;
}

// Load the vote of `voter` on `pollId`, or create an unsaved placeholder that
// only tracks nonVoteStake until the voter casts a vote
export function createOrLoadVote(voter: Bytes, pollId: Bytes): Vote {
  let id = makeVoteId(voter, pollId);
  let vote = Vote.load(id);

  if (vote == null) {
    vote = new Vote(id);
    vote.voter = voter;
    vote.voteStake = ZERO_BD;
    vote.nonVoteStake = ZERO_BD;

    // bool types must be set to something before they can accessed
    vote.registeredTranscoder = false;
  }

  return vote;
}

// The poll address of a vote id built by makeVoteId
export function pollIdFromVoteId(voteId: string): Bytes {
  return Bytes.fromHexString(voteId.slice(voteId.indexOf("-") + 1));
}

// Index of `value` in `list` by content (Array#indexOf compares references)
export function indexOfBytes(list: Array<Bytes>, value: Bytes): i32 {
  for (let i = 0; i < list.length; i++) {
    if (list[i].equals(value)) {
      return i;
    }
  }
  return -1;
}

export function createOrLoadTranscoder(id: Bytes, timestamp: i32): Transcoder {
  let transcoder = Transcoder.load(id);
  if (transcoder == null) {
    transcoder = new Transcoder(id);
    transcoder.activationTimestamp = 0;
    transcoder.activationRound = ZERO_BI;
    transcoder.deactivationRound = ZERO_BI;
    transcoder.lastActiveStakeUpdateRound = ZERO_BI;
    transcoder.active = false;
    transcoder.status = "NotRegistered";
    transcoder.rewardCut = ZERO_BI;
    transcoder.rewardCutUpdateTimestamp = 0;
    transcoder.feeShare = ZERO_BI;
    transcoder.feeShareUpdateTimestamp = 0;
    transcoder.totalStake = ZERO_BD;
    transcoder.totalVolumeETH = ZERO_BD;
    transcoder.totalVolumeUSD = ZERO_BD;
    transcoder.thirtyDayVolumeETH = ZERO_BD;
    transcoder.sixtyDayVolumeETH = ZERO_BD;
    transcoder.ninetyDayVolumeETH = ZERO_BD;
    transcoder.recentFeeDays = [];
    transcoder.recentDailyVolumeETH = [];
    transcoder.delegatorCount = ZERO_BI;
    transcoder.save();
  }

  let account = createOrUpdateLivepeerAccount(id, timestamp);
  account.delegate = transcoder.id;
  account.save();

  return transcoder;
}

export function createOrLoadDelegator(id: Bytes, timestamp: i32): Delegator {
  let delegator = Delegator.load(id);
  if (delegator == null) {
    delegator = new Delegator(id);
    delegator.startRound = ZERO_BI;
    delegator.bondedAmount = ZERO_BD;
    delegator.principal = ZERO_BD;
    delegator.unbonded = ZERO_BD;
    delegator.fees = ZERO_BD;
    delegator.withdrawnFees = ZERO_BD;
    delegator.delegatedAmount = ZERO_BD;
    delegator.save();
  }

  let account = createOrUpdateLivepeerAccount(id, timestamp);
  account.delegator = delegator.id;
  account.save();

  return delegator;
}

// Keep Protocol/Round delegatorsCount and Transcoder.delegatorCount in step
// with a delegator moving between unbonded (bondedAmount == 0) and bonded
// states, or switching delegate while bonded. The transcoders passed in must
// be the same instances the caller later saves, otherwise the caller's save
// would overwrite these counts.
export function updateDelegatorCounts(
  wasBonded: boolean,
  oldDelegate: Transcoder | null,
  isBonded: boolean,
  newDelegate: Transcoder | null,
  protocol: Protocol,
  round: Round
): void {
  if (wasBonded && !isBonded) {
    protocol.delegatorsCount = protocol.delegatorsCount.minus(ONE_BI);
    round.delegatorsCount = round.delegatorsCount.minus(ONE_BI);
  } else if (!wasBonded && isBonded) {
    protocol.delegatorsCount = protocol.delegatorsCount.plus(ONE_BI);
    round.delegatorsCount = round.delegatorsCount.plus(ONE_BI);
  }

  let sameDelegate =
    oldDelegate != null &&
    newDelegate != null &&
    oldDelegate!.id.equals(newDelegate!.id);
  if (wasBonded && oldDelegate != null && !(isBonded && sameDelegate)) {
    oldDelegate!.delegatorCount = oldDelegate!.delegatorCount.minus(ONE_BI);
  }
  if (isBonded && newDelegate != null && !(wasBonded && sameDelegate)) {
    newDelegate!.delegatorCount = newDelegate!.delegatorCount.plus(ONE_BI);
  }
}

export function createOrUpdateLivepeerAccount(
  id: Bytes,
  timestamp: i32
): LivepeerAccount {
  let account = LivepeerAccount.load(id);
  if (account == null) {
    account = new LivepeerAccount(id);
    account.delegator = EMPTY_ADDRESS;
    account.delegate = EMPTY_ADDRESS;
  }

  account.lastUpdatedTimestamp = timestamp;
  account.save();

  return account;
}

// Record the protocol's current state in the ProtocolDataPoint time series,
// which DailyProtocolStats aggregates per day
export function recordProtocolDataPoint(
  protocol: Protocol,
  block: ethereum.Block,
  volumeETH: BigDecimal,
  volumeUSD: BigDecimal
): void {
  // graph-node assigns the id and overwrites the timestamp with the block's
  let point = new ProtocolDataPoint(0);
  point.timestamp = timeseriesTimestamp(block);
  point.volumeETH = volumeETH;
  point.volumeUSD = volumeUSD;
  point.totalActiveStake = protocol.totalActiveStake;
  point.totalSupply = protocol.totalSupply;
  point.participationRate = protocol.participationRate;
  point.inflation = protocol.inflation;
  point.numActiveTranscoders = protocol.numActiveTranscoders;
  point.activeTranscoderCount = protocol.activeTranscoderCount;
  point.delegatorsCount = protocol.delegatorsCount;
  point.save();
}

// Timeseries timestamps are microseconds since the epoch
export function timeseriesTimestamp(block: ethereum.Block): i64 {
  return block.timestamp.toI64() * 1000000;
}

let ROLLING_WINDOW_DAYS = 90;

// Add fees to the transcoder's bounded daily history (newest first, at most
// 90 days), which backs the 30/60/90 day volume fields
export function addRecentFeeVolume(
  transcoder: Transcoder,
  timestamp: i32,
  amount: BigDecimal
): void {
  let today = timestamp / 86400;
  let days = transcoder.recentFeeDays;
  let volumes = transcoder.recentDailyVolumeETH;
  if (days.length > 0 && days[0] == today) {
    volumes[0] = volumes[0].plus(amount);
  } else {
    days.unshift(today);
    volumes.unshift(amount);
  }
  transcoder.recentFeeDays = days;
  transcoder.recentDailyVolumeETH = volumes;
  updateRollingVolumes(transcoder, timestamp);
}

// Recompute the 30/60/90 day volume fields as of `timestamp` and drop days
// older than the window
export function updateRollingVolumes(
  transcoder: Transcoder,
  timestamp: i32
): void {
  let today = timestamp / 86400;
  let days = transcoder.recentFeeDays;
  let volumes = transcoder.recentDailyVolumeETH;
  let keptDays = new Array<i32>();
  let keptVolumes = new Array<BigDecimal>();
  let thirty = ZERO_BD;
  let sixty = ZERO_BD;
  let ninety = ZERO_BD;

  for (let i = 0; i < days.length; i++) {
    let age = today - days[i];
    if (age >= ROLLING_WINDOW_DAYS) {
      break;
    }
    keptDays.push(days[i]);
    keptVolumes.push(volumes[i]);
    ninety = ninety.plus(volumes[i]);
    if (age < 60) {
      sixty = sixty.plus(volumes[i]);
    }
    if (age < 30) {
      thirty = thirty.plus(volumes[i]);
    }
  }

  transcoder.recentFeeDays = keptDays;
  transcoder.recentDailyVolumeETH = keptVolumes;
  transcoder.thirtyDayVolumeETH = thirty;
  transcoder.sixtyDayVolumeETH = sixty;
  transcoder.ninetyDayVolumeETH = ninety;
}

export function createOrLoadRound(
  protocol: Protocol,
  blockNumber: BigInt
): Round {
  let roundsSinceLastUpdate = blockNumber
    .minus(protocol.lastRoundLengthUpdateStartBlock)
    .div(protocol.roundLength);

  let newRound = integerFromString(protocol.lastRoundLengthUpdateRound).plus(
    roundsSinceLastUpdate
  );

  let round = Round.load(newRound.toString());

  if (round) {
    // We are already aware of this round so just return it without creating a new one
    return round;
  }

  // Need to get the start block according to the contracts, not just the start block this
  // entity was created in the subgraph
  let startBlock = protocol.lastRoundLengthUpdateStartBlock.plus(
    roundsSinceLastUpdate.times(protocol.roundLength)
  );
  // We are not aware of this round so create and return it
  protocol.roundCount = protocol.roundCount + 1;
  protocol.currentRound = newRound.toString();
  protocol.save();

  return createRound(protocol, startBlock, protocol.roundLength, newRound);
}

export function createRound(
  protocol: Protocol,
  startBlock: BigInt,
  roundLength: BigInt,
  roundNumber: BigInt
): Round {
  let round = new Round(roundNumber.toString());
  round.startBlock = startBlock;
  round.endBlock = startBlock.plus(roundLength);
  round.initialized = false;
  round.length = roundLength;
  round.startBlock = startBlock;
  round.totalActiveStake = protocol.totalActiveStake;
  round.totalSupply = protocol.totalSupply;
  round.participationRate = protocol.participationRate;
  round.mintableTokens = ZERO_BD;
  round.volumeETH = ZERO_BD;
  round.volumeUSD = ZERO_BD;
  round.movedStake = ZERO_BD;
  round.newStake = ZERO_BD;
  round.delegatorsCount = ZERO_BI;
  round.numActiveTranscoders = ZERO_BI;
  round.activeTranscoderCount = ZERO_BI;
  round.inflation = ZERO_BI;
  round.startTimestamp = 0;

  round.save();
  return round;
}

// return 0 if denominator is 0 in division
export function safeDiv(amount0: BigDecimal, amount1: BigDecimal): BigDecimal {
  if (amount1.equals(ZERO_BD)) {
    return ZERO_BD;
  } else {
    return amount0.div(amount1);
  }
}

// A fresh price outside [cached / FACTOR, cached * FACTOR] is treated as a bad
// read and rejected, unless the cached price is older than the window below,
// so a genuine move after a long gap without tickets is still accepted.
let ETH_PRICE_SANITY_FACTOR = BigDecimal.fromString("2");
// ~1 day of Arbitrum One blocks
let ETH_PRICE_SANITY_WINDOW_BLOCKS = BigInt.fromI32(345600);

// ETH price in USD, cached on Protocol per block: every eth_call made while
// processing a block is evaluated against that block's final state, so the
// value cannot change within it. Mutates `protocol`; the caller saves it.
export function getEthPriceUsd(
  protocol: Protocol,
  block: ethereum.Block
): BigDecimal {
  if (
    protocol.ethPriceCachedAtBlock.equals(block.number) &&
    protocol.ethPriceUsd.gt(ZERO_BD)
  ) {
    return protocol.ethPriceUsd;
  }

  // ethPriceCachedAtBlock is only moved when a price is accepted, so a run of
  // rejected reads cannot keep the cached price "recent" indefinitely.
  let cached = protocol.ethPriceUsd;
  let price = getPriceForPair(UNISWAP_V3_DAI_ETH_POOL_ADDRESS);
  if (price === null) {
    return cached;
  }

  let fresh = price as BigDecimal;
  let cacheIsRecent = block.number
    .minus(protocol.ethPriceCachedAtBlock)
    .lt(ETH_PRICE_SANITY_WINDOW_BLOCKS);
  if (
    cached.gt(ZERO_BD) &&
    cacheIsRecent &&
    (fresh.gt(cached.times(ETH_PRICE_SANITY_FACTOR)) ||
      fresh.times(ETH_PRICE_SANITY_FACTOR).lt(cached))
  ) {
    log.warning(
      "getEthPriceUsd: rejecting price {} at block {}, cached price is {}",
      [fresh.toString(), block.number.toString(), cached.toString()]
    );
    return cached;
  }

  protocol.ethPriceUsd = fresh;
  protocol.ethPriceCachedAtBlock = block.number;
  return fresh;
}

// LPT price in ETH, or null if it could not be read.
export function getLptPriceEth(): BigDecimal | null {
  return getPriceForPair(UNISWAP_V3_LPT_ETH_POOL_ADDRESS);
}

// Price of token1 in token0 from a Uniswap V3 pool, or null when the network
// has no pool (empty address) or the slot0 call reverts.
export function getPriceForPair(address: string): BigDecimal | null {
  if (address == "") {
    return null;
  }

  let uniswapPool = UniswapV3Pool.bind(Address.fromString(address));
  let slot0 = uniswapPool.try_slot0();
  if (slot0.reverted) {
    log.warning("slot0 reverted for Uniswap V3 pool {}", [address]);
    return null;
  }

  let prices = sqrtPriceX96ToTokenPrices(
    slot0.value.value0,
    BigInt.fromI32(18),
    BigInt.fromI32(18)
  );
  return prices[1];
}

let Q192 = "6277101735386680763835789423207666416102355444464034512896"; // 2 ** 192
function sqrtPriceX96ToTokenPrices(
  sqrtPriceX96: BigInt,
  token0Decimals: BigInt,
  token1Decimals: BigInt
): BigDecimal[] {
  let num = sqrtPriceX96.times(sqrtPriceX96).toBigDecimal();
  let denom = BigDecimal.fromString(Q192);
  let price1 = num
    .div(denom)
    .times(exponentToBigDecimal(token0Decimals))
    .div(exponentToBigDecimal(token1Decimals));

  let price0 = safeDiv(BigDecimal.fromString("1"), price1);
  return [price0, price1];
}

export function integerFromString(s: string): BigInt {
  return BigInt.fromString(s);
}


// RoundsManager.blockNum() (the L1 block number on Arbitrum), cached on
// Protocol per L2 block since the eth_call result cannot change within one.
// Mutates and saves `protocol` on a cache miss; pass the caller's instance.
export function getBlockNum(protocol: Protocol, block: ethereum.Block): BigInt {
  if (
    protocol.l1BlockCachedAtL2Block.equals(block.number) &&
    protocol.l1BlockNum.gt(ZERO_BI)
  ) {
    return protocol.l1BlockNum;
  }

  let roundsManager = RoundsManager.bind(
    Address.fromString(ROUNDS_MANAGER_ADDRESS)
  );
  protocol.l1BlockNum = roundsManager.blockNum();
  protocol.l1BlockCachedAtL2Block = block.number;
  protocol.save();
  return protocol.l1BlockNum;
}
