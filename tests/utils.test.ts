import { BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  afterEach,
  assert,
  beforeEach,
  clearStore,
  dataSourceMock,
  describe,
  test,
} from "matchstick-as/assembly/index";
import { Round, Transaction, Vote } from "../src/types/schema";
import {
  convertToDecimal,
  createOrLoadBroadcaster,
  createOrLoadBroadcasterDay,
  createOrLoadDay,
  createOrLoadDelegator,
  createOrLoadPool,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  createOrLoadTranscoder,
  createOrLoadTranscoderDay,
  createOrLoadVote,
  createOrUpdateLivepeerAccount,
  exponentToBigDecimal,
  getBlockNum,
  getBondingManagerAddress,
  getEthPriceUsd,
  getLptPriceEth,
  getMinterAddress,
  getPriceForPair,
  getRoundsManagerAddress,
  getTimestampForDaysPast,
  getUniswapV3DaiEthPoolAddress,
  getUniswapV3LptEthPoolAddress,
  integerFromString,
  makeEventId,
  makePoolId,
  makeUnbondingLockId,
  makeVoteId,
  safeDiv,
} from "../utils/helpers";
import {
  ARBITRUM_GOERLI,
  ARBITRUM_GOERLI_UNISWAP_POOL,
  ARBITRUM_ONE,
  BROADCASTER,
  CURRENT_ROUND,
  CURRENT_ROUND_START_BLOCK,
  DAI_ETH_POOL,
  DAY_ID,
  DAY_START,
  DELEGATOR_A,
  DEVELOPMENT,
  DEVELOPMENT_ROUNDS_MANAGER,
  DEVELOPMENT_UNISWAP_POOL,
  L1_BLOCK,
  LPT_ETH_POOL,
  MAX_UINT256,
  OTHER_TX_HASH,
  POLL,
  ROUND_LENGTH,
  SECONDS_PER_DAY,
  TIMESTAMP,
  TRANSCODER_A,
  TX_HASH,
  ZERO_ADDRESS,
} from "./helpers/constants";
import { createPauseEvent, inTransaction } from "./helpers/events";
import {
  mockBlockNum,
  mockRoundLength,
  mockRoundLengthReverts,
  mockSlot0,
  mockSlot0Reverts,
  sqrtPriceX96ForPrice,
} from "./helpers/mocks";
import { decimal, seedProtocol, seedTranscoder } from "./helpers/store";

beforeEach(() => {
  dataSourceMock.setNetwork(ARBITRUM_ONE);
});

afterEach(() => {
  clearStore();
});

// ---------------------------------------------------------------------------
// IDs
// ---------------------------------------------------------------------------

describe("entity id helpers", () => {
  test("makePoolId left-pads the round to ten digits", () => {
    assert.stringEquals(
      "0000000012-" + TRANSCODER_A.toHex(),
      makePoolId(TRANSCODER_A.toHex(), "12")
    );
  });

  test("makePoolId leaves a round of ten or more digits unpadded", () => {
    assert.stringEquals(
      "12345678901-" + TRANSCODER_A.toHex(),
      makePoolId(TRANSCODER_A.toHex(), "12345678901")
    );
  });

  test("makeUnbondingLockId left-pads the lock id", () => {
    assert.stringEquals(
      "0000000007-" + DELEGATOR_A.toHex(),
      makeUnbondingLockId(DELEGATOR_A, BigInt.fromI32(7))
    );
    assert.stringEquals(
      "0000000000-" + DELEGATOR_A.toHex(),
      makeUnbondingLockId(DELEGATOR_A, BigInt.zero())
    );
  });

  test("makeVoteId joins voter and poll", () => {
    assert.stringEquals(
      DELEGATOR_A.toHex() + "-" + POLL.toHex(),
      makeVoteId(DELEGATOR_A.toHex(), POLL.toHex())
    );
  });

  test("makeEventId joins transaction hash and log index", () => {
    assert.stringEquals(TX_HASH.toHex() + "-3", makeEventId(TX_HASH, BigInt.fromI32(3)));
    assert.stringEquals(TX_HASH.toHex() + "-0", makeEventId(TX_HASH, BigInt.zero()));
  });
});

// ---------------------------------------------------------------------------
// Number helpers
// ---------------------------------------------------------------------------

describe("number helpers", () => {
  test("exponentToBigDecimal returns 10^n, including n = 0", () => {
    assert.stringEquals("1", exponentToBigDecimal(BigInt.zero()).toString());
    assert.stringEquals("1000000000000000000", exponentToBigDecimal(BigInt.fromI32(18)).toString());
  });

  test("convertToDecimal converts wei to tokens", () => {
    assert.stringEquals("0", convertToDecimal(BigInt.zero()).toString());
    assert.stringEquals("0.000000000000000001", convertToDecimal(BigInt.fromI32(1)).toString());
    assert.stringEquals(
      "1.5",
      convertToDecimal(BigInt.fromString("1500000000000000000")).toString()
    );
  });

  test("convertToDecimal keeps 34 significant digits of the largest uint256", () => {
    assert.stringEquals(
      "115792089237316195423570985008687900000000000000000000000000",
      convertToDecimal(MAX_UINT256).toString()
    );
  });

  test("safeDiv divides, and returns zero for a zero divisor", () => {
    assert.stringEquals("0.25", safeDiv(decimal("1"), decimal("4")).toString());
    assert.stringEquals("0", safeDiv(decimal("1"), decimal("0")).toString());
    assert.stringEquals("0", safeDiv(decimal("0"), decimal("4")).toString());
  });

  test("integerFromString parses round ids, including very large ones", () => {
    assert.bigIntEquals(BigInt.fromI32(12), integerFromString("12"));
    // Compared as strings: Matchstick's bigIntEquals cannot hold a full-width uint256.
    assert.stringEquals(MAX_UINT256.toString(), integerFromString(MAX_UINT256.toString()).toString());
  });

  test("getTimestampForDaysPast subtracts whole days", () => {
    assert.i32Equals(TIMESTAMP - 30 * SECONDS_PER_DAY, getTimestampForDaysPast(TIMESTAMP, 30));
    assert.i32Equals(TIMESTAMP, getTimestampForDaysPast(TIMESTAMP, 0));
  });
});

// ---------------------------------------------------------------------------
// Network-dependent addresses
// ---------------------------------------------------------------------------

describe("network addresses", () => {
  test("arbitrum-one resolves to the mainnet contracts", () => {
    assert.stringEquals("35Bcf3c30594191d53231E4FF333E8A770453e40", getBondingManagerAddress());
    assert.stringEquals("dd6f56DcC28D3F5f27084381fE8Df634985cc39f", getRoundsManagerAddress());
    assert.stringEquals("c20DE37170B45774e6CD3d2304017fc962f27252", getMinterAddress());
    assert.stringEquals("a961f0473da4864c5ed28e00fcc53a3aab056c1b", getUniswapV3DaiEthPoolAddress());
    assert.stringEquals("4fd47e5102dfbf95541f64ed6fe13d4ed26d2546", getUniswapV3LptEthPoolAddress());
  });

  test("arbitrum-goerli resolves to the testnet contracts", () => {
    dataSourceMock.setNetwork(ARBITRUM_GOERLI);

    assert.stringEquals("4bB92357243CC1aB9Cc578cCC6A6Aa3Ad9B853bF", getBondingManagerAddress());
    assert.stringEquals("862F638260062Ee1e89a9a2D72CBE8aa7201704f", getRoundsManagerAddress());
    assert.stringEquals("7cD8BEfd49050329F48F0ec9f0E29dE1E274E3A2", getMinterAddress());
  });

  test("any other network falls back to the development contracts", () => {
    dataSourceMock.setNetwork(DEVELOPMENT);

    assert.stringEquals("f71AA2E1DE77E8eE9cbB88A91Dbd228FF3160635", getBondingManagerAddress());
    assert.stringEquals("4D3620B1d9146116707d763AEbFe3dF59E00a883", getRoundsManagerAddress());
    assert.stringEquals("3Eb31D0b427e40F01FA3d38F627fE928a33DA0E3", getMinterAddress());
  });
});

// ---------------------------------------------------------------------------
// eth_call helpers
// ---------------------------------------------------------------------------

describe("prices and block number", () => {
  // Q192 has 58 digits but BigDecimal keeps 34, so every price carries a
  // rounding error in the 34th significant digit.
  test("getPriceForPair converts sqrtPriceX96 to a price", () => {
    mockSlot0(DAI_ETH_POOL, sqrtPriceX96ForPrice(2));

    assert.stringEquals(
      "4.000000000000000000000000000000001",
      getPriceForPair(DAI_ETH_POOL.toHex()).toString()
    );
  });

  test("getPriceForPair returns zero when slot0 reverts", () => {
    mockSlot0Reverts(DAI_ETH_POOL);

    assert.stringEquals("0", getPriceForPair(DAI_ETH_POOL.toHex()).toString());
  });

  test("getPriceForPair returns zero for a pool reporting a zero price", () => {
    mockSlot0(DAI_ETH_POOL, BigInt.zero());

    assert.stringEquals("0", getPriceForPair(DAI_ETH_POOL.toHex()).toString());
  });

  test("getPriceForPair also queries the pool on arbitrum-goerli", () => {
    dataSourceMock.setNetwork(ARBITRUM_GOERLI);
    mockSlot0(ARBITRUM_GOERLI_UNISWAP_POOL, sqrtPriceX96ForPrice(3));

    assert.stringEquals(
      "9.000000000000000000000000000000001",
      getPriceForPair(ARBITRUM_GOERLI_UNISWAP_POOL.toHex()).toString()
    );
  });

  test("getPriceForPair skips the call and returns zero on other networks", () => {
    dataSourceMock.setNetwork(DEVELOPMENT);
    mockSlot0(DEVELOPMENT_UNISWAP_POOL, sqrtPriceX96ForPrice(2));

    assert.stringEquals("0", getPriceForPair(DEVELOPMENT_UNISWAP_POOL.toHex()).toString());
  });

  test("getEthPriceUsd and getLptPriceEth each read their own pool", () => {
    mockSlot0(DAI_ETH_POOL, sqrtPriceX96ForPrice(50));
    mockSlot0(LPT_ETH_POOL, sqrtPriceX96ForPrice(2));

    assert.stringEquals("2500.000000000000000000000000000001", getEthPriceUsd().toString());
    assert.stringEquals("4.000000000000000000000000000000001", getLptPriceEth().toString());
  });

  test("getBlockNum returns RoundsManager.blockNum()", () => {
    mockBlockNum(L1_BLOCK);

    assert.bigIntEquals(L1_BLOCK, getBlockNum());
  });
});

// ---------------------------------------------------------------------------
// Protocol and Round
// ---------------------------------------------------------------------------

describe("createOrLoadProtocol", () => {
  test("a first load on arbitrum-one reads roundLength and seeds the delegator count", () => {
    mockRoundLength(ROUND_LENGTH);

    createOrLoadProtocol();

    assert.fieldEquals("Protocol", "0", "roundLength", "100");
    assert.fieldEquals("Protocol", "0", "delegatorsCount", "3520");
    assert.fieldEquals("Protocol", "0", "paused", "false");
    assert.fieldEquals("Protocol", "0", "currentRound", "0");
    assert.fieldEquals("Protocol", "0", "totalSupply", "0");
    assert.fieldEquals("Protocol", "0", "activeBroadcasters", "[]");
    assert.fieldEquals("Protocol", "0", "pendingActivation", "[]");
    assert.fieldEquals("Protocol", "0", "winningTicketCount", "0");
  });

  test("a first load on another network starts the delegator count at zero", () => {
    dataSourceMock.setNetwork(DEVELOPMENT);
    mockRoundLength(ROUND_LENGTH, DEVELOPMENT_ROUNDS_MANAGER);

    createOrLoadProtocol();

    assert.fieldEquals("Protocol", "0", "delegatorsCount", "0");
  });

  test("a later load returns the stored Protocol without an eth_call", () => {
    let stored = seedProtocol();
    stored.totalSupply = decimal("1000");
    stored.save();
    mockRoundLengthReverts();

    let protocol = createOrLoadProtocol();

    assert.stringEquals("1000", protocol.totalSupply.toString());
    assert.fieldEquals("Protocol", "0", "delegatorsCount", "0");
  });
});

describe("createOrLoadRound", () => {
  test("a block in an unseen round creates it and advances the protocol", () => {
    let protocol = seedProtocol();
    protocol.totalActiveStake = decimal("400");
    protocol.totalSupply = decimal("1000");
    protocol.participationRate = decimal("0.4");
    protocol.save();

    let round = createOrLoadRound(L1_BLOCK);

    assert.stringEquals(CURRENT_ROUND, round.id);
    assert.fieldEquals("Round", CURRENT_ROUND, "startBlock", CURRENT_ROUND_START_BLOCK);
    assert.fieldEquals("Round", CURRENT_ROUND, "endBlock", "1300");
    assert.fieldEquals("Round", CURRENT_ROUND, "length", "100");
    assert.fieldEquals("Round", CURRENT_ROUND, "initialized", "false");
    assert.fieldEquals("Round", CURRENT_ROUND, "totalActiveStake", "400");
    assert.fieldEquals("Round", CURRENT_ROUND, "totalSupply", "1000");
    assert.fieldEquals("Round", CURRENT_ROUND, "participationRate", "0.4");
    assert.fieldEquals("Round", CURRENT_ROUND, "volumeETH", "0");
    assert.fieldEquals("Protocol", "0", "currentRound", CURRENT_ROUND);
    assert.fieldEquals("Protocol", "0", "roundCount", "1");
  });

  test("a block in a known round returns it without counting a new round", () => {
    seedProtocol();
    let first = createOrLoadRound(L1_BLOCK);
    first.initialized = true;
    first.save();

    let again = createOrLoadRound(BigInt.fromI32(1299));

    assert.stringEquals(CURRENT_ROUND, again.id);
    assert.booleanEquals(true, again.initialized);
    assert.fieldEquals("Protocol", "0", "roundCount", "1");
    assert.entityCount("Round", 1);
  });

  test("the first block of a round belongs to that round", () => {
    seedProtocol();

    let round = createOrLoadRound(BigInt.fromString(CURRENT_ROUND_START_BLOCK));

    assert.stringEquals(CURRENT_ROUND, round.id);
  });

  test("the last block before a round belongs to the previous round", () => {
    seedProtocol();

    let round = createOrLoadRound(BigInt.fromI32(1199));

    assert.stringEquals("11", round.id);
    assert.fieldEquals("Round", "11", "startBlock", "1100");
  });

  test("consecutive rounds each create their own entity", () => {
    seedProtocol();

    createOrLoadRound(L1_BLOCK);
    createOrLoadRound(BigInt.fromI32(1350));

    assert.fieldEquals("Round", "13", "startBlock", "1300");
    assert.fieldEquals("Protocol", "0", "currentRound", "13");
    assert.fieldEquals("Protocol", "0", "roundCount", "2");
    assert.assertNotNull(Round.load(CURRENT_ROUND));
  });
});

// ---------------------------------------------------------------------------
// Transaction
// ---------------------------------------------------------------------------

function eventWithGas(gasLimit: i32, gasUsed: i32): ethereum.Event {
  let event = createPauseEvent();
  event.block.number = BigInt.fromI32(5000);
  event.transaction.gasLimit = BigInt.fromI32(gasLimit);
  event.transaction.gasPrice = BigInt.fromI32(10);
  event.transaction.from = DELEGATOR_A;
  event.transaction.to = TRANSCODER_A;
  event.receipt!.gasUsed = BigInt.fromI32(gasUsed);
  return event;
}

describe("createOrLoadTransactionFromEvent", () => {
  test("a first event in a transaction records its block, gas and parties", () => {
    createOrLoadTransactionFromEvent(eventWithGas(300000, 210000));

    let tx = TX_HASH.toHex();
    assert.fieldEquals("Transaction", tx, "blockNumber", "5000");
    assert.fieldEquals("Transaction", tx, "gasPrice", "10");
    assert.fieldEquals("Transaction", tx, "timestamp", TIMESTAMP.toString());
    assert.fieldEquals("Transaction", tx, "from", DELEGATOR_A.toHex());
    assert.fieldEquals("Transaction", tx, "to", TRANSCODER_A.toHex());
  });

  test("a later event in the same transaction does not overwrite it", () => {
    createOrLoadTransactionFromEvent(eventWithGas(300000, 210000));
    let later = eventWithGas(999999, 999999);
    later.block.number = BigInt.fromI32(6000);

    createOrLoadTransactionFromEvent(later);

    assert.fieldEquals("Transaction", TX_HASH.toHex(), "blockNumber", "5000");
    assert.entityCount("Transaction", 1);
  });

  test("a contract-creation transaction has no recipient", () => {
    let event = eventWithGas(300000, 210000);
    event.transaction.to = null;

    createOrLoadTransactionFromEvent(inTransaction(event, OTHER_TX_HASH));

    assert.assertNull(Transaction.load(OTHER_TX_HASH.toHex())!.to);
  });

  // BDR-42 known bug: set shouldFail to false when fixed
  test(
    "BDR-42: gasUsed records the gas the transaction used, not its gas limit",
    () => {
      createOrLoadTransactionFromEvent(eventWithGas(300000, 210000));

      assert.fieldEquals("Transaction", TX_HASH.toHex(), "gasUsed", "210000");
    },
    true
  );
});

// ---------------------------------------------------------------------------
// Account entities
// ---------------------------------------------------------------------------

describe("createOrLoadTranscoder", () => {
  test("a new transcoder starts unregistered with zero stake and links its account", () => {
    createOrLoadTranscoder(TRANSCODER_A.toHex(), TIMESTAMP);

    let transcoder = TRANSCODER_A.toHex();
    assert.fieldEquals("Transcoder", transcoder, "status", "NotRegistered");
    assert.fieldEquals("Transcoder", transcoder, "active", "false");
    assert.fieldEquals("Transcoder", transcoder, "totalStake", "0");
    assert.fieldEquals("Transcoder", transcoder, "rewardCut", "0");
    assert.fieldEquals("Transcoder", transcoder, "transcoderDays", "[]");
    assert.fieldEquals("LivepeerAccount", transcoder, "delegate", transcoder);
    assert.fieldEquals("LivepeerAccount", transcoder, "lastUpdatedTimestamp", TIMESTAMP.toString());
  });

  test("an existing transcoder keeps its fields and refreshes its account timestamp", () => {
    seedTranscoder(TRANSCODER_A, "Registered", "500");

    createOrLoadTranscoder(TRANSCODER_A.toHex(), TIMESTAMP + 60);

    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "status", "Registered");
    assert.fieldEquals("Transcoder", TRANSCODER_A.toHex(), "totalStake", "500");
    assert.fieldEquals(
      "LivepeerAccount",
      TRANSCODER_A.toHex(),
      "lastUpdatedTimestamp",
      (TIMESTAMP + 60).toString()
    );
  });
});

describe("createOrLoadDelegator", () => {
  test("a new delegator starts with zero amounts and links its account", () => {
    createOrLoadDelegator(DELEGATOR_A.toHex(), TIMESTAMP);

    let delegator = DELEGATOR_A.toHex();
    assert.fieldEquals("Delegator", delegator, "bondedAmount", "0");
    assert.fieldEquals("Delegator", delegator, "principal", "0");
    assert.fieldEquals("Delegator", delegator, "unbonded", "0");
    assert.fieldEquals("Delegator", delegator, "withdrawnFees", "0");
    assert.fieldEquals("Delegator", delegator, "startRound", "0");
    assert.fieldEquals("LivepeerAccount", delegator, "delegator", delegator);
    assert.fieldEquals("LivepeerAccount", delegator, "delegate", ZERO_ADDRESS.toHex());
  });

  test("an existing delegator keeps its amounts", () => {
    let stored = createOrLoadDelegator(DELEGATOR_A.toHex(), TIMESTAMP);
    stored.bondedAmount = decimal("50");
    stored.save();

    let delegator = createOrLoadDelegator(DELEGATOR_A.toHex(), TIMESTAMP);

    assert.stringEquals("50", delegator.bondedAmount.toString());
  });
});

describe("createOrUpdateLivepeerAccount", () => {
  test("a new account points at the zero address until linked", () => {
    createOrUpdateLivepeerAccount(DELEGATOR_A.toHex(), TIMESTAMP);

    let account = DELEGATOR_A.toHex();
    assert.fieldEquals("LivepeerAccount", account, "delegator", ZERO_ADDRESS.toHex());
    assert.fieldEquals("LivepeerAccount", account, "delegate", ZERO_ADDRESS.toHex());
    assert.fieldEquals("LivepeerAccount", account, "lastUpdatedTimestamp", TIMESTAMP.toString());
  });

  test("an existing account keeps its links and takes the new timestamp", () => {
    createOrLoadDelegator(DELEGATOR_A.toHex(), TIMESTAMP);

    createOrUpdateLivepeerAccount(DELEGATOR_A.toHex(), TIMESTAMP + 60);

    let account = DELEGATOR_A.toHex();
    assert.fieldEquals("LivepeerAccount", account, "delegator", account);
    assert.fieldEquals("LivepeerAccount", account, "lastUpdatedTimestamp", (TIMESTAMP + 60).toString());
  });
});

describe("createOrLoadBroadcaster", () => {
  test("a new broadcaster starts with zero balances and no funding day", () => {
    createOrLoadBroadcaster(BROADCASTER.toHex());

    let broadcaster = BROADCASTER.toHex();
    assert.fieldEquals("Broadcaster", broadcaster, "deposit", "0");
    assert.fieldEquals("Broadcaster", broadcaster, "reserve", "0");
    assert.fieldEquals("Broadcaster", broadcaster, "firstFundedDay", "0");
    assert.fieldEquals("Broadcaster", broadcaster, "broadcasterDays", "[]");
  });

  test("an existing broadcaster keeps its balances", () => {
    let stored = createOrLoadBroadcaster(BROADCASTER.toHex());
    stored.deposit = decimal("3");
    stored.save();

    let broadcaster = createOrLoadBroadcaster(BROADCASTER.toHex());

    assert.stringEquals("3", broadcaster.deposit.toString());
  });
});

describe("createOrLoadVote", () => {
  test("a new vote is an uncast placeholder", () => {
    let id = makeVoteId(DELEGATOR_A.toHex(), POLL.toHex());

    createOrLoadVote(id);

    assert.fieldEquals("Vote", id, "voter", ZERO_ADDRESS.toHex());
    assert.fieldEquals("Vote", id, "voteStake", "0");
    assert.fieldEquals("Vote", id, "nonVoteStake", "0");
    assert.fieldEquals("Vote", id, "registeredTranscoder", "false");
    assert.assertNull(Vote.load(id)!.choiceID);
  });

  test("an existing vote is returned unchanged", () => {
    let id = makeVoteId(DELEGATOR_A.toHex(), POLL.toHex());
    let stored = createOrLoadVote(id);
    stored.choiceID = "Yes";
    stored.voteStake = decimal("100");
    stored.save();

    let vote = createOrLoadVote(id);

    assert.stringEquals("Yes", vote.choiceID!);
    assert.stringEquals("100", vote.voteStake.toString());
  });
});

// ---------------------------------------------------------------------------
// Day entities
// ---------------------------------------------------------------------------

describe("day helpers", () => {
  test("createOrLoadDay keys the day by whole days since the epoch", () => {
    createOrLoadDay(TIMESTAMP);

    assert.fieldEquals("Day", DAY_ID, "date", DAY_START.toString());
    assert.fieldEquals("Day", DAY_ID, "volumeETH", "0");
  });

  test("midnight starts a new day and the second before it does not", () => {
    createOrLoadDay(DAY_START);
    createOrLoadDay(DAY_START - 1);

    assert.fieldEquals("Day", DAY_ID, "date", DAY_START.toString());
    assert.fieldEquals("Day", "19674", "date", (DAY_START - SECONDS_PER_DAY).toString());
  });

  test("createOrLoadDay returns the stored day for a later time on the same day", () => {
    let stored = createOrLoadDay(DAY_START);
    stored.volumeETH = decimal("5");
    stored.save();

    let day = createOrLoadDay(DAY_START + SECONDS_PER_DAY - 1);

    assert.stringEquals("5", day.volumeETH.toString());
    assert.entityCount("Day", 1);
  });

  test("transcoder and broadcaster days are keyed by address and day", () => {
    createOrLoadTranscoderDay(TIMESTAMP, TRANSCODER_A.toHex());
    createOrLoadBroadcasterDay(TIMESTAMP, BROADCASTER.toHex());

    let transcoderDay = TRANSCODER_A.toHex() + "-" + DAY_ID;
    let broadcasterDay = BROADCASTER.toHex() + "-" + DAY_ID;
    assert.fieldEquals("TranscoderDay", transcoderDay, "date", DAY_START.toString());
    assert.fieldEquals("TranscoderDay", transcoderDay, "transcoder", TRANSCODER_A.toHex());
    assert.fieldEquals("BroadcasterDay", broadcasterDay, "date", DAY_START.toString());
    assert.fieldEquals("BroadcasterDay", broadcasterDay, "broadcaster", BROADCASTER.toHex());
  });

  test("an existing transcoder day keeps its volume", () => {
    let stored = createOrLoadTranscoderDay(TIMESTAMP, TRANSCODER_A.toHex());
    stored.volumeETH = decimal("2");
    stored.save();

    let day = createOrLoadTranscoderDay(DAY_START, TRANSCODER_A.toHex());

    assert.stringEquals("2", day.volumeETH.toString());
  });
});

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------

describe("createOrLoadPool", () => {
  test("a new pool copies the transcoder's stake, reward cut and fee share", () => {
    let transcoder = seedTranscoder(TRANSCODER_A, "Registered", "300");
    transcoder.rewardCut = BigInt.fromI32(500000);
    transcoder.feeShare = BigInt.fromI32(100000);
    transcoder.save();

    createOrLoadPool(CURRENT_ROUND, TRANSCODER_A.toHex());

    let pool = makePoolId(TRANSCODER_A.toHex(), CURRENT_ROUND);
    assert.fieldEquals("Pool", pool, "totalStake", "300");
    assert.fieldEquals("Pool", pool, "rewardCut", "500000");
    assert.fieldEquals("Pool", pool, "feeShare", "100000");
    assert.fieldEquals("Pool", pool, "fees", "0");
    assert.fieldEquals("Pool", pool, "round", CURRENT_ROUND);
    assert.fieldEquals("Pool", pool, "delegate", TRANSCODER_A.toHex());
  });

  test("a new pool for an unknown transcoder defaults to zero", () => {
    createOrLoadPool(CURRENT_ROUND, TRANSCODER_A.toHex());

    let pool = makePoolId(TRANSCODER_A.toHex(), CURRENT_ROUND);
    assert.fieldEquals("Pool", pool, "totalStake", "0");
    assert.fieldEquals("Pool", pool, "rewardCut", "0");
    assert.fieldEquals("Pool", pool, "feeShare", "0");
  });

  test("an existing pool is returned without re-reading the transcoder", () => {
    seedTranscoder(TRANSCODER_A, "Registered", "300");
    let stored = createOrLoadPool(CURRENT_ROUND, TRANSCODER_A.toHex());
    stored.fees = decimal("3");
    stored.save();
    seedTranscoder(TRANSCODER_A, "Registered", "999");

    let pool = createOrLoadPool(CURRENT_ROUND, TRANSCODER_A.toHex());

    assert.stringEquals("300", pool.totalStake.toString());
    assert.stringEquals("3", pool.fees.toString());
  });
});
