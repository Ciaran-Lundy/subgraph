import { BigInt } from "@graphprotocol/graph-ts";
import {
  afterEach,
  assert,
  beforeEach,
  clearStore,
  dataSourceMock,
  describe,
  test,
} from "matchstick-as/assembly/index";
import {
  depositFunded,
  reserveClaimed,
  reserveFunded,
  winningTicketRedeemed,
  withdrawal,
} from "../src/mappings/ticketBroker";
import { makePoolId } from "../utils/helpers";
import {
  ARBITRUM_ONE,
  BROADCASTER,
  CURRENT_ROUND,
  DAI_ETH_POOL,
  DAY_ID,
  DAY_START,
  eventId,
  L1_BLOCK,
  SECONDS_PER_DAY,
  TIMESTAMP,
  tokens,
  TRANSCODER_A,
  TX_HASH,
} from "./helpers/constants";
import {
  atLogIndex,
  atTimestamp,
  createDepositFundedEvent,
  createReserveClaimedEvent,
  createReserveFundedEvent,
  createWinningTicketRedeemedEvent,
  createWithdrawalEvent,
} from "./helpers/events";
import {
  mockBlockNum,
  mockSlot0,
  mockSlot0Reverts,
  sqrtPriceX96ForPrice,
} from "./helpers/mocks";
import { seedBroadcaster, seedProtocol } from "./helpers/store";

// sqrtPrice 50 encodes an ETH price of 2500 USD. getPriceForPair rounds Q192
// to 34 significant digits, so 2 ETH comes out a hair over 5000 USD.
const ETH_PRICE_SQRT = 50;
const TWO_ETH_IN_USD = "5000.000000000000000000000000000002";
const NEXT_DAY_TIMESTAMP = TIMESTAMP + SECONDS_PER_DAY;
const NEXT_DAY_ID = "19676";

beforeEach(() => {
  dataSourceMock.setNetwork(ARBITRUM_ONE);
  seedProtocol();
  mockBlockNum(L1_BLOCK);
  mockSlot0(DAI_ETH_POOL, sqrtPriceX96ForPrice(ETH_PRICE_SQRT));
});

afterEach(() => {
  clearStore();
});

function redeem(faceValue: BigInt, logIndex: i32): void {
  winningTicketRedeemed(
    atLogIndex(createWinningTicketRedeemedEvent(BROADCASTER, TRANSCODER_A, faceValue), logIndex)
  );
}

function broadcasterDayId(day: string): string {
  return BROADCASTER.toHex() + "-" + day;
}

function transcoderDayId(day: string): string {
  return TRANSCODER_A.toHex() + "-" + day;
}

// A 3 LPT ticket against a broadcaster holding a 1 LPT deposit and 10 LPT reserve.
function redeemTicketLargerThanDeposit(): void {
  seedBroadcaster(BROADCASTER, "1", "10");
  redeem(tokens(3), 1);
}

describe("winningTicketRedeemed", () => {
  test("a ticket smaller than the deposit is paid from the deposit", () => {
    seedBroadcaster(BROADCASTER, "10", "5");

    redeem(tokens(2), 1);

    let broadcaster = BROADCASTER.toHex();
    assert.fieldEquals("Broadcaster", broadcaster, "deposit", "8");
    assert.fieldEquals("Broadcaster", broadcaster, "reserve", "5");
    assert.fieldEquals("Broadcaster", broadcaster, "totalVolumeETH", "2");
    assert.fieldEquals("Broadcaster", broadcaster, "totalVolumeUSD", TWO_ETH_IN_USD);
    assert.fieldEquals("Broadcaster", broadcaster, "lastFundedDay", DAY_START.toString());
    assert.fieldEquals("Broadcaster", broadcaster, "lastActiveDay", DAY_START.toString());
    assert.fieldEquals(
      "Broadcaster",
      broadcaster,
      "broadcasterDays",
      "[" + broadcasterDayId(DAY_ID) + "]"
    );
    assert.fieldEquals("BroadcasterDay", broadcasterDayId(DAY_ID), "volumeETH", "2");
    assert.fieldEquals("BroadcasterDay", broadcasterDayId(DAY_ID), "volumeUSD", TWO_ETH_IN_USD);

    let transcoder = TRANSCODER_A.toHex();
    assert.fieldEquals("Transcoder", transcoder, "totalVolumeETH", "2");
    assert.fieldEquals("Transcoder", transcoder, "totalVolumeUSD", TWO_ETH_IN_USD);
    assert.fieldEquals(
      "Transcoder",
      transcoder,
      "transcoderDays",
      "[" + transcoderDayId(DAY_ID) + "]"
    );
    assert.fieldEquals("TranscoderDay", transcoderDayId(DAY_ID), "volumeETH", "2");
    assert.fieldEquals("Pool", makePoolId(transcoder, CURRENT_ROUND), "fees", "2");

    assert.fieldEquals("Protocol", "0", "totalVolumeETH", "2");
    assert.fieldEquals("Protocol", "0", "totalVolumeUSD", TWO_ETH_IN_USD);
    assert.fieldEquals("Protocol", "0", "winningTicketCount", "1");
    assert.fieldEquals("Protocol", "0", "activeBroadcasters", "[" + broadcaster + "]");
    assert.fieldEquals("Day", DAY_ID, "volumeETH", "2");
    assert.fieldEquals("Day", DAY_ID, "volumeUSD", TWO_ETH_IN_USD);
    assert.fieldEquals("Round", CURRENT_ROUND, "volumeETH", "2");
    assert.fieldEquals("Round", CURRENT_ROUND, "volumeUSD", TWO_ETH_IN_USD);

    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("WinningTicketRedeemedEvent", id, "sender", broadcaster);
    assert.fieldEquals("WinningTicketRedeemedEvent", id, "recipient", transcoder);
    assert.fieldEquals("WinningTicketRedeemedEvent", id, "faceValue", "2");
    assert.fieldEquals("WinningTicketRedeemedEvent", id, "faceValueUSD", TWO_ETH_IN_USD);
    assert.fieldEquals("WinningTicketRedeemedEvent", id, "winProb", "1000");
    assert.fieldEquals("WinningTicketRedeemedEvent", id, "senderNonce", "7");
    assert.fieldEquals("WinningTicketRedeemedEvent", id, "recipientRand", "42");
    assert.fieldEquals("WinningTicketRedeemedEvent", id, "auxData", "0xabcd");
    assert.fieldEquals("WinningTicketRedeemedEvent", id, "round", CURRENT_ROUND);
  });

  test("a ticket equal to the deposit empties the deposit and spares the reserve", () => {
    seedBroadcaster(BROADCASTER, "2", "5");

    redeem(tokens(2), 1);

    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "deposit", "0");
    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "reserve", "5");
  });

  test("a ticket larger than the deposit empties the deposit and counts the full face value", () => {
    redeemTicketLargerThanDeposit();

    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "deposit", "0");
    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "totalVolumeETH", "3");
    assert.fieldEquals("WinningTicketRedeemedEvent", eventId(TX_HASH, 1), "faceValue", "3");
  });

  // BDR-1 known bug: set shouldFail to false when fixed
  // reserveClaimed already deducts the claimed amount, so winningTicketRedeemed
  // must not touch the reserve at all (today it deducts the full face value).
  test(
    "BDR-1: a ticket larger than the deposit leaves the reserve to reserveClaimed",
    () => {
      redeemTicketLargerThanDeposit();

      assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "reserve", "10");
    },
    true
  );

  test("a first-time broadcaster with an empty deposit and reserve stays at zero", () => {
    redeem(tokens(1), 1);

    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "deposit", "0");
    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "reserve", "0");
    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "totalVolumeETH", "1");
  });

  test("a zero-value ticket changes no balance but is counted", () => {
    seedBroadcaster(BROADCASTER, "10", "5");

    redeem(BigInt.zero(), 1);

    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "deposit", "10");
    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "totalVolumeETH", "0");
    assert.fieldEquals("Protocol", "0", "winningTicketCount", "1");
  });

  test("two tickets in one transaction accumulate without duplicating day entries", () => {
    seedBroadcaster(BROADCASTER, "10", "5");

    redeem(tokens(2), 1);
    redeem(tokens(3), 2);

    let broadcaster = BROADCASTER.toHex();
    assert.fieldEquals("Broadcaster", broadcaster, "deposit", "5");
    assert.fieldEquals("Broadcaster", broadcaster, "totalVolumeETH", "5");
    assert.fieldEquals(
      "Broadcaster",
      broadcaster,
      "broadcasterDays",
      "[" + broadcasterDayId(DAY_ID) + "]"
    );
    assert.fieldEquals(
      "Transcoder",
      TRANSCODER_A.toHex(),
      "transcoderDays",
      "[" + transcoderDayId(DAY_ID) + "]"
    );
    assert.fieldEquals("BroadcasterDay", broadcasterDayId(DAY_ID), "volumeETH", "5");
    assert.fieldEquals("Pool", makePoolId(TRANSCODER_A.toHex(), CURRENT_ROUND), "fees", "5");
    assert.fieldEquals("Protocol", "0", "winningTicketCount", "2");
    assert.fieldEquals("Protocol", "0", "activeBroadcasters", "[" + broadcaster + "]");
    assert.entityCount("WinningTicketRedeemedEvent", 2);
    assert.entityCount("Transaction", 1);
  });

  test("tickets on consecutive days list the newest day first", () => {
    seedBroadcaster(BROADCASTER, "10", "5");

    redeem(tokens(2), 1);
    winningTicketRedeemed(
      atTimestamp(
        createWinningTicketRedeemedEvent(BROADCASTER, TRANSCODER_A, tokens(3)),
        NEXT_DAY_TIMESTAMP
      )
    );

    assert.fieldEquals(
      "Broadcaster",
      BROADCASTER.toHex(),
      "broadcasterDays",
      "[" + broadcasterDayId(NEXT_DAY_ID) + ", " + broadcasterDayId(DAY_ID) + "]"
    );
    assert.fieldEquals(
      "Transcoder",
      TRANSCODER_A.toHex(),
      "transcoderDays",
      "[" + transcoderDayId(NEXT_DAY_ID) + ", " + transcoderDayId(DAY_ID) + "]"
    );
    assert.fieldEquals("Day", NEXT_DAY_ID, "volumeETH", "3");
    assert.fieldEquals("Day", DAY_ID, "volumeETH", "2");
  });

  // Pins today's zero-price fallback. BDR-6 and BDR-41 replace it with a
  // cached, sanity-bounded price, which will change this test.
  test("a reverting slot0 call values the ticket at zero USD", () => {
    seedBroadcaster(BROADCASTER, "10", "5");
    mockSlot0Reverts(DAI_ETH_POOL);

    redeem(tokens(2), 1);

    assert.fieldEquals("WinningTicketRedeemedEvent", eventId(TX_HASH, 1), "faceValueUSD", "0");
    assert.fieldEquals("Protocol", "0", "totalVolumeETH", "2");
    assert.fieldEquals("Protocol", "0", "totalVolumeUSD", "0");
  });
});

describe("depositFunded", () => {
  test("first funding records the deposit and the start of the funding day", () => {
    depositFunded(createDepositFundedEvent(BROADCASTER, tokens(5)));

    let broadcaster = BROADCASTER.toHex();
    assert.fieldEquals("Broadcaster", broadcaster, "deposit", "5");
    assert.fieldEquals("Broadcaster", broadcaster, "firstFundedDay", DAY_START.toString());
    assert.fieldEquals("Broadcaster", broadcaster, "firstActiveDay", DAY_START.toString());
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("DepositFundedEvent", id, "sender", broadcaster);
    assert.fieldEquals("DepositFundedEvent", id, "amount", "5");
    assert.fieldEquals("DepositFundedEvent", id, "round", CURRENT_ROUND);
  });

  test("a later funding adds to the deposit and keeps the first funding day", () => {
    depositFunded(createDepositFundedEvent(BROADCASTER, tokens(5)));
    depositFunded(
      atTimestamp(createDepositFundedEvent(BROADCASTER, tokens(2)), NEXT_DAY_TIMESTAMP)
    );

    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "deposit", "7");
    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "firstFundedDay", DAY_START.toString());
  });

  test("a zero deposit still marks the first funding day", () => {
    depositFunded(createDepositFundedEvent(BROADCASTER, BigInt.zero()));

    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "deposit", "0");
    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "firstFundedDay", DAY_START.toString());
  });
});

describe("reserveFunded", () => {
  test("first funding records the reserve and the start of the funding day", () => {
    reserveFunded(createReserveFundedEvent(BROADCASTER, tokens(10)));

    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "reserve", "10");
    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "firstFundedDay", DAY_START.toString());
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("ReserveFundedEvent", id, "reserveHolder", BROADCASTER.toHex());
    assert.fieldEquals("ReserveFundedEvent", id, "amount", "10");
  });

  test("funding a reserve after a deposit keeps the deposit's funding day", () => {
    depositFunded(createDepositFundedEvent(BROADCASTER, tokens(5)));
    reserveFunded(
      atLogIndex(
        atTimestamp(createReserveFundedEvent(BROADCASTER, tokens(10)), NEXT_DAY_TIMESTAMP),
        2
      )
    );

    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "deposit", "5");
    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "reserve", "10");
    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "firstFundedDay", DAY_START.toString());
  });
});

describe("reserveClaimed", () => {
  test("a claim reduces the reserve and records the claimant", () => {
    seedBroadcaster(BROADCASTER, "0", "10");

    reserveClaimed(createReserveClaimedEvent(BROADCASTER, TRANSCODER_A, tokens(4)));

    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "reserve", "6");
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("ReserveClaimedEvent", id, "claimant", TRANSCODER_A.toHex());
    assert.fieldEquals("ReserveClaimedEvent", id, "reserveHolder", BROADCASTER.toHex());
    assert.fieldEquals("ReserveClaimedEvent", id, "amount", "4");
  });

  test("two claims in one transaction both reduce the reserve", () => {
    seedBroadcaster(BROADCASTER, "0", "10");

    reserveClaimed(createReserveClaimedEvent(BROADCASTER, TRANSCODER_A, tokens(4)));
    reserveClaimed(atLogIndex(createReserveClaimedEvent(BROADCASTER, TRANSCODER_A, tokens(5)), 2));

    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "reserve", "1");
    assert.entityCount("ReserveClaimedEvent", 2);
  });
});

describe("withdrawal", () => {
  test("zeroes the deposit and reserve and records what was withdrawn", () => {
    seedBroadcaster(BROADCASTER, "3", "7");

    withdrawal(createWithdrawalEvent(BROADCASTER, tokens(3), tokens(7)));

    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "deposit", "0");
    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "reserve", "0");
    let id = eventId(TX_HASH, 1);
    assert.fieldEquals("WithdrawalEvent", id, "deposit", "3");
    assert.fieldEquals("WithdrawalEvent", id, "reserve", "7");
    assert.fieldEquals("WithdrawalEvent", id, "sender", BROADCASTER.toHex());
  });

  test("a withdrawal by an unknown broadcaster creates it with zero balances", () => {
    withdrawal(createWithdrawalEvent(BROADCASTER, BigInt.zero(), BigInt.zero()));

    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "deposit", "0");
    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "reserve", "0");
    assert.fieldEquals("Broadcaster", BROADCASTER.toHex(), "firstFundedDay", "0");
  });
});
