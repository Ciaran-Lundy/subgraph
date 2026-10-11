import { Address, BigInt, ethereum } from "@graphprotocol/graph-ts";
import {
  afterEach,
  assert,
  beforeEach,
  clearStore,
  createMockedFunction,
  describe,
  test,
} from "matchstick-as";
import {
  depositFunded,
  reserveClaimed,
  reserveFunded,
  winningTicketRedeemed,
  winningTicketTransfer,
} from "../src/mappings/ticketBroker";
import { UNISWAP_V3_DAI_ETH_POOL_ADDRESS } from "../utils/addresses";
import { DepositFunded, ReserveFunded } from "../src/types/TicketBroker/TicketBroker";
import { newMockEvent } from "matchstick-as";
import {
  createReserveClaimed,
  createWinningTicketRedeemed,
  createWinningTicketTransfer,
  mockRoundsManager,
  ticketBroker,
  TX_A,
  TX_B,
  wei,
} from "./helpers";

const sender = Address.fromString("0x1000000000000000000000000000000000000001");
const recipient = Address.fromString("0x2000000000000000000000000000000000000002");
const recipient2 = Address.fromString("0x3000000000000000000000000000000000000003");

// sqrtPriceX96 = 2 * 2^96, i.e. a price of 4
const SQRT_PRICE_X96 = BigInt.fromString("158456325028528675187087900672");

function mockEthPrice(): void {
  if (UNISWAP_V3_DAI_ETH_POOL_ADDRESS == "") {
    return;
  }
  createMockedFunction(
    Address.fromString(UNISWAP_V3_DAI_ETH_POOL_ADDRESS),
    "slot0",
    "slot0():(uint160,int24,uint16,uint16,uint16,uint8,bool)"
  )
    .withArgs([])
    .returns([
      ethereum.Value.fromUnsignedBigInt(SQRT_PRICE_X96),
      ethereum.Value.fromI32(0),
      ethereum.Value.fromI32(0),
      ethereum.Value.fromI32(0),
      ethereum.Value.fromI32(0),
      ethereum.Value.fromI32(0),
      ethereum.Value.fromBoolean(true),
    ]);
}

function fund(deposit: BigInt, reserve: BigInt): void {
  let d = changetype<DepositFunded>(newMockEvent());
  d.address = ticketBroker;
  d.parameters = new Array();
  d.parameters.push(new ethereum.EventParam("sender", ethereum.Value.fromAddress(sender)));
  d.parameters.push(new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(deposit)));
  depositFunded(d);

  let r = changetype<ReserveFunded>(newMockEvent());
  r.address = ticketBroker;
  r.logIndex = BigInt.fromI32(1);
  r.parameters = new Array();
  r.parameters.push(new ethereum.EventParam("reserveHolder", ethereum.Value.fromAddress(sender)));
  r.parameters.push(new ethereum.EventParam("amount", ethereum.Value.fromUnsignedBigInt(reserve)));
  reserveFunded(r);
}

describe("winningTicketRedeemed (BDR-1)", () => {
  beforeEach(() => {
    mockRoundsManager();
    mockEthPrice();
  });

  afterEach(() => {
    clearStore();
  });

  test("ticket covered by the deposit only reduces the deposit", () => {
    fund(wei(2), wei(5));
    winningTicketTransfer(createWinningTicketTransfer(sender, recipient, wei(1), 10, TX_A));
    winningTicketRedeemed(createWinningTicketRedeemed(sender, recipient, wei(1), 11, TX_A));

    let id = sender.toHex();
    assert.fieldEquals("Broadcaster", id, "deposit", "1");
    assert.fieldEquals("Broadcaster", id, "reserve", "5");
    assert.fieldEquals("Broadcaster", id, "totalVolumeETH", "1");
    assert.fieldEquals("Transcoder", recipient.toHex(), "totalVolumeETH", "1");
  });

  test("deposit shortfall is charged to the reserve once, via ReserveClaimed", () => {
    // faceValue 3 against a deposit of 1: 2 is claimed from the reserve
    fund(wei(1), wei(5));
    reserveClaimed(createReserveClaimed(sender, recipient, wei(2), 10, TX_A));
    winningTicketTransfer(createWinningTicketTransfer(sender, recipient, wei(3), 11, TX_A));
    winningTicketRedeemed(createWinningTicketRedeemed(sender, recipient, wei(3), 12, TX_A));

    let id = sender.toHex();
    assert.fieldEquals("Broadcaster", id, "deposit", "0");
    // Previously 5 - 2 (claim) - 3 (faceValue) = 0
    assert.fieldEquals("Broadcaster", id, "reserve", "3");
    assert.fieldEquals("Broadcaster", id, "totalVolumeETH", "3");
  });

  test("volume uses the transferred amount when the reserve claim is capped", () => {
    // faceValue 10 against a deposit of 1, but only 2 can be claimed
    fund(wei(1), wei(2));
    reserveClaimed(createReserveClaimed(sender, recipient, wei(2), 10, TX_A));
    winningTicketTransfer(createWinningTicketTransfer(sender, recipient, wei(3), 11, TX_A));
    winningTicketRedeemed(createWinningTicketRedeemed(sender, recipient, wei(10), 12, TX_A));

    assert.fieldEquals("Broadcaster", sender.toHex(), "reserve", "0");
    assert.fieldEquals("Broadcaster", sender.toHex(), "totalVolumeETH", "3");
    assert.fieldEquals("Protocol", "0", "totalVolumeETH", "3");
    assert.fieldEquals("WinningTicketRedeemedEvent", TX_A + "-12", "faceValue", "10");
  });

  test("tickets batched in one transaction are matched by log index", () => {
    fund(wei(10), wei(0));
    winningTicketTransfer(createWinningTicketTransfer(sender, recipient, wei(1), 20, TX_B));
    winningTicketRedeemed(createWinningTicketRedeemed(sender, recipient, wei(1), 21, TX_B));
    winningTicketTransfer(createWinningTicketTransfer(sender, recipient2, wei(4), 22, TX_B));
    winningTicketRedeemed(createWinningTicketRedeemed(sender, recipient2, wei(4), 23, TX_B));

    assert.fieldEquals("Transcoder", recipient.toHex(), "totalVolumeETH", "1");
    assert.fieldEquals("Transcoder", recipient2.toHex(), "totalVolumeETH", "4");
    assert.fieldEquals("Broadcaster", sender.toHex(), "deposit", "5");
  });

  test("a redemption with no transfer (nothing paid) adds no volume", () => {
    winningTicketRedeemed(createWinningTicketRedeemed(sender, recipient, wei(1), 11, TX_A));

    assert.fieldEquals("Broadcaster", sender.toHex(), "totalVolumeETH", "0");
    assert.fieldEquals("Transcoder", recipient.toHex(), "totalVolumeETH", "0");
  });
});
