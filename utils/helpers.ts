import {
  Address,
  BigDecimal,
  BigInt,
  Bytes,
  dataSource,
  ethereum,
  log,
} from "@graphprotocol/graph-ts";
import { RoundsManager } from "../src/types/RoundsManager/RoundsManager";
import {
  Broadcaster,
  BroadcasterDay,
  Day,
  Delegator,
  LivepeerAccount,
  Pool,
  Protocol,
  Round,
  Transaction,
  Transcoder,
  TranscoderDay,
  Vote,
} from "../src/types/schema";
import { UniswapV3Pool } from "../src/types/TicketBroker/UniswapV3Pool";

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
export function makePoolId(transcoderAddress: string, roundId: string): string {
  return leftPad(roundId, 10) + "-" + transcoderAddress;
}

export function createOrLoadPool(roundId: string, transcoderAddress: string): Pool {
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
  delegatorAddress: string,
  pollAddress: string
): string {
  return delegatorAddress + "-" + pollAddress;
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
  let tx = Transaction.load(event.transaction.hash.toHex());
  if (tx == null) {
    tx = new Transaction(event.transaction.hash.toHex());

    tx.blockNumber = event.block.number;
    tx.gasUsed = event.transaction.gasLimit;
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
      Address.fromString(getRoundsManagerAddress())
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
    protocol.activeBroadcasters = [];

    // Counted exactly from bonded-state transitions (see updateDelegatorCounts)
    protocol.delegatorsCount = ZERO_BI;

    protocol.pendingActivation = [];
    protocol.pendingDeactivation = [];
    protocol.save();
  }

  return protocol;
}

export function createOrLoadBroadcaster(id: string): Broadcaster {
  let broadcaster = Broadcaster.load(id);

  if (broadcaster == null) {
    broadcaster = new Broadcaster(id);
    broadcaster.deposit = ZERO_BD;
    broadcaster.reserve = ZERO_BD;
    broadcaster.totalVolumeETH = ZERO_BD;
    broadcaster.totalVolumeUSD = ZERO_BD;
    broadcaster.thirtyDayVolumeETH = ZERO_BD;
    broadcaster.sixtyDayVolumeETH = ZERO_BD;
    broadcaster.ninetyDayVolumeETH = ZERO_BD;
    broadcaster.firstFundedDay = 0;
    broadcaster.firstActiveDay = 0;
    broadcaster.lastFundedDay = 0;
    broadcaster.lastActiveDay = 0;
    broadcaster.broadcasterDays = [];

    broadcaster.save();
  } 
  
  return broadcaster;
}

export function createOrLoadVote(id: string): Vote {
  let vote = Vote.load(id);

  if (vote == null) {
    vote = new Vote(id);
    vote.voter = EMPTY_ADDRESS.toHexString();
    vote.voteStake = ZERO_BD;
    vote.nonVoteStake = ZERO_BD;

    // bool types must be set to something before they can accessed
    vote.registeredTranscoder = false;

    vote.save();
  }

  return vote;
}

export function createOrLoadTranscoder(id: string, timestamp: i32): Transcoder {
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
    transcoder.transcoderDays = [];
    transcoder.delegatorCount = ZERO_BI;
    transcoder.save();
  }

  let account = createOrUpdateLivepeerAccount(id, timestamp);
  account.delegate = transcoder.id;
  account.save();

  return transcoder;
}

export function createOrLoadDelegator(id: string, timestamp: i32): Delegator {
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
    oldDelegate!.id == newDelegate!.id;
  if (wasBonded && oldDelegate != null && !(isBonded && sameDelegate)) {
    oldDelegate!.delegatorCount = oldDelegate!.delegatorCount.minus(ONE_BI);
  }
  if (isBonded && newDelegate != null && !(wasBonded && sameDelegate)) {
    newDelegate!.delegatorCount = newDelegate!.delegatorCount.plus(ONE_BI);
  }
}

export function createOrUpdateLivepeerAccount(id: string, timestamp: i32): LivepeerAccount {
  let account = LivepeerAccount.load(id);
  if (account == null) {
    account = new LivepeerAccount(id);
    account.delegator = EMPTY_ADDRESS.toHex();
    account.delegate = EMPTY_ADDRESS.toHex();
  }

  account.lastUpdatedTimestamp = timestamp;
  account.save();

  return account;
}

export function createOrLoadDay(timestamp: i32): Day {
  let dayID = timestamp / 86400;
  let dayStartTimestamp = dayID * 86400;
  let day = Day.load(dayID.toString());

  if (day == null) {
    day = new Day(dayID.toString());
    day.date = dayStartTimestamp;
    day.volumeUSD = ZERO_BD;
    day.volumeETH = ZERO_BD;
    day.totalSupply = ZERO_BD;
    day.totalActiveStake = ZERO_BD;
    day.participationRate = ZERO_BD;
    day.delegatorsCount = ZERO_BI;
    day.numActiveTranscoders = ZERO_BI;
    day.activeTranscoderCount = ZERO_BI;
    day.inflation = ZERO_BI;

    day.save();
  }
  return day;
}

export function createOrLoadTranscoderDay(
  timestamp: i32,
  transcoderAddress: string
): TranscoderDay {
  let dayID = timestamp / 86400;
  let dayStartTimestamp = dayID * 86400;
  let transcoderDayID = transcoderAddress
    .concat("-")
    .concat(BigInt.fromI32(dayID).toString());
  let transcoderDay = TranscoderDay.load(transcoderDayID);

  if (transcoderDay == null) {
    transcoderDay = new TranscoderDay(transcoderDayID);
    transcoderDay.date = dayStartTimestamp;
    transcoderDay.transcoder = transcoderAddress;
    transcoderDay.volumeUSD = ZERO_BD;
    transcoderDay.volumeETH = ZERO_BD;

    transcoderDay.save();
  }
  return transcoderDay;
}

export function createOrLoadBroadcasterDay(
  timestamp: i32,
  broadcasterAddress: string
): BroadcasterDay {
  let dayID = timestamp / 86400;
  let dayStartTimestamp = dayID * 86400;
  let broadcasterDayID = broadcasterAddress
    .concat("-")
    .concat(BigInt.fromI32(dayID).toString());
  let broadcasterDay = BroadcasterDay.load(broadcasterDayID);

  if (broadcasterDay == null) {
    broadcasterDay = new BroadcasterDay(broadcasterDayID);
    broadcasterDay.date = dayStartTimestamp;
    broadcasterDay.broadcaster = broadcasterAddress;
    broadcasterDay.volumeUSD = ZERO_BD;
    broadcasterDay.volumeETH = ZERO_BD;

    broadcasterDay.save();
  }
  return broadcasterDay;
}

// `protocol` must be the caller's own Protocol instance: this function updates
// and saves it when it creates a new round.
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

export function getTimestampForDaysPast(currentTimestamp: i32, days: i32): i32 {
  return currentTimestamp - days * 86400;
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
  let price = getPriceForPair(getUniswapV3DaiEthPoolAddress());
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
  return getPriceForPair(getUniswapV3LptEthPoolAddress());
}

// Price of token1 in token0 from a Uniswap V3 pool, or null when the network
// has no pool or the slot0 call reverts.
export function getPriceForPair(address: string): BigDecimal | null {
  if (
    dataSource.network() != "arbitrum-one" &&
    dataSource.network() != "arbitrum-goerli"
  ) {
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

export function getUniswapV3LptEthPoolAddress(): string {
  const network = dataSource.network();

  if (network == "arbitrum-one") {
    return "4fd47e5102dfbf95541f64ed6fe13d4ed26d2546";
  } else if (network == "arbitrum-goerli") {
    return "01ab0834e140f1d33c99b6380a77a6b75b283b3f";
  } else {
    return "0xffa7ee1c08416565d054b2cf3e336dcfe21591e5";
  }
}

export function getUniswapV3DaiEthPoolAddress(): string {
  const network = dataSource.network();

  if (network == "arbitrum-one") {
    return "a961f0473da4864c5ed28e00fcc53a3aab056c1b";
  } else if (network == "arbitrum-goerli") {
    return "01ab0834e140f1d33c99b6380a77a6b75b283b3f";
  } else {
    return "0xffa7ee1c08416565d054b2cf3e336dcfe21591e5";
  }
}

export function getBondingManagerAddress(): string {
  const network = dataSource.network();

  if (network == "arbitrum-one") {
    return "35Bcf3c30594191d53231E4FF333E8A770453e40";
  } else if (network == "arbitrum-goerli") {
    return "4bB92357243CC1aB9Cc578cCC6A6Aa3Ad9B853bF";
  } else {
    return "f71AA2E1DE77E8eE9cbB88A91Dbd228FF3160635";
  }
}

export function getRoundsManagerAddress(): string {
  const network = dataSource.network();

  if (network == "arbitrum-one") {
    return "dd6f56DcC28D3F5f27084381fE8Df634985cc39f";
  } else if (network == "arbitrum-goerli") {
    return "862F638260062Ee1e89a9a2D72CBE8aa7201704f";
  } else {
    return "4D3620B1d9146116707d763AEbFe3dF59E00a883";
  }
}

export function getMinterAddress(): string {
  const network = dataSource.network();

  if (network == "arbitrum-one") {
    return "c20DE37170B45774e6CD3d2304017fc962f27252";
  } else if (network == "arbitrum-goerli") {
    return "7cD8BEfd49050329F48F0ec9f0E29dE1E274E3A2";
  } else {
    return "3Eb31D0b427e40F01FA3d38F627fE928a33DA0E3";
  }
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
    Address.fromString(getRoundsManagerAddress())
  );
  protocol.l1BlockNum = roundsManager.blockNum();
  protocol.l1BlockCachedAtL2Block = block.number;
  protocol.save();
  return protocol.l1BlockNum;
}
