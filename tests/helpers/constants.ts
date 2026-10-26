import { Address, BigInt, Bytes } from "@graphprotocol/graph-ts";

// Network the mappings run under in production. Several helpers branch on
// dataSource.network(), so every test sets it explicitly.
export const ARBITRUM_ONE = "arbitrum-one";
export const ARBITRUM_GOERLI = "arbitrum-goerli";
export const DEVELOPMENT = "development";

// Contract addresses the mappings bind to on arbitrum-one (see utils/helpers.ts).
export const BONDING_MANAGER = Address.fromString(
  "0x35Bcf3c30594191d53231E4FF333E8A770453e40"
);
export const ROUNDS_MANAGER = Address.fromString(
  "0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f"
);
export const MINTER = Address.fromString(
  "0xc20DE37170B45774e6CD3d2304017fc962f27252"
);
export const TICKET_BROKER = Address.fromString(
  "0xa8bB618B1520E284046F3dFc448851A1Ff26e41B"
);
export const LIVEPEER_TOKEN = Address.fromString(
  "0x289ba1701C2F088cf0faf8B3705246331cB8A839"
);
export const L2_MIGRATOR = Address.fromString(
  "0x148D5b6B4df9530c7C76A810bd1Cdf69EC4c2085"
);
export const CONTROLLER = Address.fromString(
  "0xD8E8328501E9645d16Cf49539efC04f734606ee4"
);
export const SERVICE_REGISTRY = Address.fromString(
  "0xC92d3A360b8f9e083bA64DE15d95Cf8180897431"
);
export const POLL_CREATOR = Address.fromString(
  "0x8bb50806D60c492c0004DAD5D9627DAA2d9732E6"
);
export const LIVEPEER_GOVERNOR = Address.fromString(
  "0xcFE4E2879B786C3aa075813F0E364bb5acCb6aa0"
);
export const DAI_ETH_POOL = Address.fromString(
  "0xa961f0473da4864c5ed28e00fcc53a3aab056c1b"
);
export const LPT_ETH_POOL = Address.fromString(
  "0x4fd47e5102dfbf95541f64ed6fe13d4ed26d2546"
);
export const ARBITRUM_GOERLI_UNISWAP_POOL = Address.fromString(
  "0x01ab0834e140f1d33c99b6380a77a6b75b283b3f"
);
// Addresses the helpers fall back to on networks other than arbitrum.
export const DEVELOPMENT_UNISWAP_POOL = Address.fromString(
  "0xffa7ee1c08416565d054b2cf3e336dcfe21591e5"
);
export const DEVELOPMENT_ROUNDS_MANAGER = Address.fromString(
  "0x4D3620B1d9146116707d763AEbFe3dF59E00a883"
);

// Actors
export const ZERO_ADDRESS = Address.zero();
export const TRANSCODER_A = Address.fromString(
  "0x00000000000000000000000000000000000000a1"
);
export const TRANSCODER_B = Address.fromString(
  "0x00000000000000000000000000000000000000a2"
);
export const DELEGATOR_A = Address.fromString(
  "0x00000000000000000000000000000000000000d1"
);
export const DELEGATOR_B = Address.fromString(
  "0x00000000000000000000000000000000000000d2"
);
export const BROADCASTER = Address.fromString(
  "0x00000000000000000000000000000000000000b1"
);
export const POLL = Address.fromString(
  "0x00000000000000000000000000000000000000c1"
);

// Round fixture: with a round length of 100 L1 blocks, last updated at block
// 1000 in round 10, L1 block 1250 falls in round 12 (blocks 1200-1299).
export const ROUND_LENGTH = BigInt.fromI32(100);
export const LAST_ROUND_LENGTH_UPDATE_START_BLOCK = BigInt.fromI32(1000);
export const LAST_ROUND_LENGTH_UPDATE_ROUND = "10";
export const L1_BLOCK = BigInt.fromI32(1250);
export const CURRENT_ROUND = "12";
export const NEXT_ROUND = "13";
export const CURRENT_ROUND_START_BLOCK = "1200";

// 2023-11-14T22:13:20Z, which falls on day 19675 (starting at 1699920000).
export const TIMESTAMP = 1700000000;
export const DAY_ID = "19675";
export const DAY_START = 1699920000;
export const SECONDS_PER_DAY = 86400;

export const TX_HASH = Bytes.fromHexString(
  "0x1111111111111111111111111111111111111111111111111111111111111111"
);
export const OTHER_TX_HASH = Bytes.fromHexString(
  "0x2222222222222222222222222222222222222222222222222222222222222222"
);

// 2^256 - 1. Note utils/helpers.ts's MAXIMUM_VALUE_UINT256 is 2^255 - 1.
export const MAX_UINT256 = BigInt.fromString(
  "115792089237316195423570985008687907853269984665640564039457584007913129639935"
);

const WEI_PER_LPT = BigInt.fromString("1000000000000000000");

// Whole token amounts in wei, so assertions read as the decimal the mapping stores.
export function tokens(amount: i32): BigInt {
  return BigInt.fromI32(amount).times(WEI_PER_LPT);
}

export function eventId(txHash: Bytes, logIndex: i32): string {
  return txHash.toHex() + "-" + logIndex.toString();
}
