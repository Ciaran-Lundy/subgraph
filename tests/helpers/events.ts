import { Address, BigInt, Bytes, ethereum } from "@graphprotocol/graph-ts";
import { newMockEvent } from "matchstick-as/assembly/index";
import {
  Bond,
  EarningsClaimed,
  ParameterUpdate as BondingManagerParameterUpdate,
  Rebond,
  Reward,
  RewardCallerSet,
  TranscoderActivated,
  TranscoderDeactivated,
  TranscoderSlashed,
  TranscoderUpdate,
  TransferBond,
  Unbond,
  WithdrawFees,
  WithdrawStake,
} from "../../src/types/BondingManager/BondingManager";
import { Pause, Unpause } from "../../src/types/Controller/Controller";
import {
  MigrateDelegatorFinalized,
  StakeClaimed,
} from "../../src/types/L2Migrator/L2Migrator";
import { Burn, Mint } from "../../src/types/LivepeerToken/LivepeerToken";
import {
  ParameterUpdate as MinterParameterUpdate,
  SetCurrentRewardTokens,
} from "../../src/types/Minter/Minter";
import { PollCreated } from "../../src/types/PollCreator/PollCreator";
import {
  NewRound,
  ParameterUpdate as RoundsManagerParameterUpdate,
} from "../../src/types/RoundsManager/RoundsManager";
import { ServiceURIUpdate } from "../../src/types/ServiceRegistry/ServiceRegistry";
import { Vote } from "../../src/types/templates/Poll/Poll";
import {
  DepositFunded,
  ReserveClaimed,
  ReserveFunded,
  WinningTicketRedeemed,
  Withdrawal,
} from "../../src/types/TicketBroker/TicketBroker";
import {
  ProposalCreated,
  VoteCast,
  VoteCastWithParams,
} from "../../src/types/Treasury/LivepeerGovernor";
import {
  BONDING_MANAGER,
  CONTROLLER,
  L2_MIGRATOR,
  LIVEPEER_GOVERNOR,
  LIVEPEER_TOKEN,
  MINTER,
  POLL,
  POLL_CREATOR,
  ROUNDS_MANAGER,
  SERVICE_REGISTRY,
  TICKET_BROKER,
  TIMESTAMP,
  TX_HASH,
} from "./constants";

// Every builder returns an event from `emitter` in transaction TX_HASH at log
// index 1 and block timestamp TIMESTAMP. Tests that need several events in one
// transaction, or events in a later block, change those fields on the result.
function baseEvent(
  emitter: Address,
  params: Array<ethereum.EventParam>
): ethereum.Event {
  let event = newMockEvent();
  event.address = emitter;
  event.parameters = params;
  event.logIndex = BigInt.fromI32(1);
  event.transaction.hash = TX_HASH;
  event.block.timestamp = BigInt.fromI32(TIMESTAMP);
  return event;
}

export function atLogIndex<T extends ethereum.Event>(event: T, logIndex: i32): T {
  event.logIndex = BigInt.fromI32(logIndex);
  return event;
}

export function atTimestamp<T extends ethereum.Event>(event: T, timestamp: i32): T {
  event.block.timestamp = BigInt.fromI32(timestamp);
  return event;
}

export function inTransaction<T extends ethereum.Event>(event: T, hash: Bytes): T {
  event.transaction.hash = hash;
  return event;
}

function addressParam(name: string, value: Address): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromAddress(value));
}

function uintParam(name: string, value: BigInt): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromUnsignedBigInt(value));
}

function i32Param(name: string, value: i32): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromI32(value));
}

function stringParam(name: string, value: string): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromString(value));
}

function bytesParam(name: string, value: Bytes): ethereum.EventParam {
  return new ethereum.EventParam(name, ethereum.Value.fromBytes(value));
}

// ---------------------------------------------------------------------------
// BondingManager
// ---------------------------------------------------------------------------

export function createBondEvent(
  newDelegate: Address,
  oldDelegate: Address,
  delegator: Address,
  additionalAmount: BigInt,
  bondedAmount: BigInt
): Bond {
  return changetype<Bond>(
    baseEvent(BONDING_MANAGER, [
      addressParam("newDelegate", newDelegate),
      addressParam("oldDelegate", oldDelegate),
      addressParam("delegator", delegator),
      uintParam("additionalAmount", additionalAmount),
      uintParam("bondedAmount", bondedAmount),
    ])
  );
}

export function createUnbondEvent(
  delegate: Address,
  delegator: Address,
  unbondingLockId: BigInt,
  amount: BigInt,
  withdrawRound: BigInt
): Unbond {
  return changetype<Unbond>(
    baseEvent(BONDING_MANAGER, [
      addressParam("delegate", delegate),
      addressParam("delegator", delegator),
      uintParam("unbondingLockId", unbondingLockId),
      uintParam("amount", amount),
      uintParam("withdrawRound", withdrawRound),
    ])
  );
}

export function createRebondEvent(
  delegate: Address,
  delegator: Address,
  unbondingLockId: BigInt,
  amount: BigInt
): Rebond {
  return changetype<Rebond>(
    baseEvent(BONDING_MANAGER, [
      addressParam("delegate", delegate),
      addressParam("delegator", delegator),
      uintParam("unbondingLockId", unbondingLockId),
      uintParam("amount", amount),
    ])
  );
}

export function createTransferBondEvent(
  oldDelegator: Address,
  newDelegator: Address,
  oldUnbondingLockId: BigInt,
  newUnbondingLockId: BigInt,
  amount: BigInt
): TransferBond {
  return changetype<TransferBond>(
    baseEvent(BONDING_MANAGER, [
      addressParam("oldDelegator", oldDelegator),
      addressParam("newDelegator", newDelegator),
      uintParam("oldUnbondingLockId", oldUnbondingLockId),
      uintParam("newUnbondingLockId", newUnbondingLockId),
      uintParam("amount", amount),
    ])
  );
}

export function createWithdrawStakeEvent(
  delegator: Address,
  unbondingLockId: BigInt,
  amount: BigInt,
  withdrawRound: BigInt
): WithdrawStake {
  return changetype<WithdrawStake>(
    baseEvent(BONDING_MANAGER, [
      addressParam("delegator", delegator),
      uintParam("unbondingLockId", unbondingLockId),
      uintParam("amount", amount),
      uintParam("withdrawRound", withdrawRound),
    ])
  );
}

export function createWithdrawFeesEvent(
  delegator: Address,
  recipient: Address,
  amount: BigInt
): WithdrawFees {
  return changetype<WithdrawFees>(
    baseEvent(BONDING_MANAGER, [
      addressParam("delegator", delegator),
      addressParam("recipient", recipient),
      uintParam("amount", amount),
    ])
  );
}

export function createBondingManagerParameterUpdateEvent(
  param: string
): BondingManagerParameterUpdate {
  return changetype<BondingManagerParameterUpdate>(
    baseEvent(BONDING_MANAGER, [stringParam("param", param)])
  );
}

export function createRewardEvent(transcoder: Address, amount: BigInt): Reward {
  return changetype<Reward>(
    baseEvent(BONDING_MANAGER, [
      addressParam("transcoder", transcoder),
      uintParam("amount", amount),
    ])
  );
}

export function createTranscoderSlashedEvent(
  transcoder: Address,
  finder: Address,
  penalty: BigInt,
  finderReward: BigInt
): TranscoderSlashed {
  return changetype<TranscoderSlashed>(
    baseEvent(BONDING_MANAGER, [
      addressParam("transcoder", transcoder),
      addressParam("finder", finder),
      uintParam("penalty", penalty),
      uintParam("finderReward", finderReward),
    ])
  );
}

export function createTranscoderUpdateEvent(
  transcoder: Address,
  rewardCut: BigInt,
  feeShare: BigInt
): TranscoderUpdate {
  return changetype<TranscoderUpdate>(
    baseEvent(BONDING_MANAGER, [
      addressParam("transcoder", transcoder),
      uintParam("rewardCut", rewardCut),
      uintParam("feeShare", feeShare),
    ])
  );
}

export function createRewardCallerSetEvent(
  transcoder: Address,
  rewardCaller: Address
): RewardCallerSet {
  return changetype<RewardCallerSet>(
    baseEvent(BONDING_MANAGER, [
      addressParam("transcoder", transcoder),
      addressParam("rewardCaller", rewardCaller),
    ])
  );
}

export function createTranscoderActivatedEvent(
  transcoder: Address,
  activationRound: BigInt
): TranscoderActivated {
  return changetype<TranscoderActivated>(
    baseEvent(BONDING_MANAGER, [
      addressParam("transcoder", transcoder),
      uintParam("activationRound", activationRound),
    ])
  );
}

export function createTranscoderDeactivatedEvent(
  transcoder: Address,
  deactivationRound: BigInt
): TranscoderDeactivated {
  return changetype<TranscoderDeactivated>(
    baseEvent(BONDING_MANAGER, [
      addressParam("transcoder", transcoder),
      uintParam("deactivationRound", deactivationRound),
    ])
  );
}

export function createEarningsClaimedEvent(
  delegate: Address,
  delegator: Address,
  rewards: BigInt,
  fees: BigInt,
  startRound: BigInt,
  endRound: BigInt
): EarningsClaimed {
  return changetype<EarningsClaimed>(
    baseEvent(BONDING_MANAGER, [
      addressParam("delegate", delegate),
      addressParam("delegator", delegator),
      uintParam("rewards", rewards),
      uintParam("fees", fees),
      uintParam("startRound", startRound),
      uintParam("endRound", endRound),
    ])
  );
}

// ---------------------------------------------------------------------------
// TicketBroker
// ---------------------------------------------------------------------------

export function createWinningTicketRedeemedEvent(
  sender: Address,
  recipient: Address,
  faceValue: BigInt
): WinningTicketRedeemed {
  return changetype<WinningTicketRedeemed>(
    baseEvent(TICKET_BROKER, [
      addressParam("sender", sender),
      addressParam("recipient", recipient),
      uintParam("faceValue", faceValue),
      uintParam("winProb", BigInt.fromI32(1000)),
      uintParam("senderNonce", BigInt.fromI32(7)),
      uintParam("recipientRand", BigInt.fromI32(42)),
      bytesParam("auxData", Bytes.fromHexString("0xabcd")),
    ])
  );
}

export function createDepositFundedEvent(
  sender: Address,
  amount: BigInt
): DepositFunded {
  return changetype<DepositFunded>(
    baseEvent(TICKET_BROKER, [
      addressParam("sender", sender),
      uintParam("amount", amount),
    ])
  );
}

export function createReserveFundedEvent(
  reserveHolder: Address,
  amount: BigInt
): ReserveFunded {
  return changetype<ReserveFunded>(
    baseEvent(TICKET_BROKER, [
      addressParam("reserveHolder", reserveHolder),
      uintParam("amount", amount),
    ])
  );
}

export function createReserveClaimedEvent(
  reserveHolder: Address,
  claimant: Address,
  amount: BigInt
): ReserveClaimed {
  return changetype<ReserveClaimed>(
    baseEvent(TICKET_BROKER, [
      addressParam("reserveHolder", reserveHolder),
      addressParam("claimant", claimant),
      uintParam("amount", amount),
    ])
  );
}

export function createWithdrawalEvent(
  sender: Address,
  deposit: BigInt,
  reserve: BigInt
): Withdrawal {
  return changetype<Withdrawal>(
    baseEvent(TICKET_BROKER, [
      addressParam("sender", sender),
      uintParam("deposit", deposit),
      uintParam("reserve", reserve),
    ])
  );
}

// ---------------------------------------------------------------------------
// RoundsManager
// ---------------------------------------------------------------------------

export function createNewRoundEvent(round: BigInt, blockHash: Bytes): NewRound {
  return changetype<NewRound>(
    baseEvent(ROUNDS_MANAGER, [
      uintParam("round", round),
      bytesParam("blockHash", blockHash),
    ])
  );
}

export function createRoundsManagerParameterUpdateEvent(
  param: string
): RoundsManagerParameterUpdate {
  return changetype<RoundsManagerParameterUpdate>(
    baseEvent(ROUNDS_MANAGER, [stringParam("param", param)])
  );
}

// ---------------------------------------------------------------------------
// LivepeerToken and Minter
// ---------------------------------------------------------------------------

export function createMintEvent(to: Address, amount: BigInt): Mint {
  return changetype<Mint>(
    baseEvent(LIVEPEER_TOKEN, [
      addressParam("to", to),
      uintParam("amount", amount),
    ])
  );
}

export function createBurnEvent(burner: Address, value: BigInt): Burn {
  return changetype<Burn>(
    baseEvent(LIVEPEER_TOKEN, [
      addressParam("burner", burner),
      uintParam("value", value),
    ])
  );
}

export function createSetCurrentRewardTokensEvent(
  currentMintableTokens: BigInt,
  currentInflation: BigInt
): SetCurrentRewardTokens {
  return changetype<SetCurrentRewardTokens>(
    baseEvent(MINTER, [
      uintParam("currentMintableTokens", currentMintableTokens),
      uintParam("currentInflation", currentInflation),
    ])
  );
}

export function createMinterParameterUpdateEvent(
  param: string
): MinterParameterUpdate {
  return changetype<MinterParameterUpdate>(
    baseEvent(MINTER, [stringParam("param", param)])
  );
}

// ---------------------------------------------------------------------------
// L2Migrator
// ---------------------------------------------------------------------------

export function createMigrateDelegatorFinalizedEvent(
  l1Addr: Address,
  l2Addr: Address,
  stake: BigInt,
  delegatedStake: BigInt,
  fees: BigInt,
  delegate: Address
): MigrateDelegatorFinalized {
  let migration = new ethereum.Tuple();
  migration.push(ethereum.Value.fromAddress(l1Addr));
  migration.push(ethereum.Value.fromAddress(l2Addr));
  migration.push(ethereum.Value.fromUnsignedBigInt(stake));
  migration.push(ethereum.Value.fromUnsignedBigInt(delegatedStake));
  migration.push(ethereum.Value.fromUnsignedBigInt(fees));
  migration.push(ethereum.Value.fromAddress(delegate));
  return changetype<MigrateDelegatorFinalized>(
    baseEvent(L2_MIGRATOR, [
      new ethereum.EventParam("params", ethereum.Value.fromTuple(migration)),
    ])
  );
}

export function createStakeClaimedEvent(
  delegator: Address,
  delegate: Address,
  stake: BigInt,
  fees: BigInt
): StakeClaimed {
  return changetype<StakeClaimed>(
    baseEvent(L2_MIGRATOR, [
      addressParam("delegator", delegator),
      addressParam("delegate", delegate),
      uintParam("stake", stake),
      uintParam("fees", fees),
    ])
  );
}

// ---------------------------------------------------------------------------
// Controller and ServiceRegistry
// ---------------------------------------------------------------------------

export function createPauseEvent(): Pause {
  return changetype<Pause>(baseEvent(CONTROLLER, []));
}

export function createUnpauseEvent(): Unpause {
  return changetype<Unpause>(baseEvent(CONTROLLER, []));
}

export function createServiceURIUpdateEvent(
  addr: Address,
  serviceURI: string
): ServiceURIUpdate {
  return changetype<ServiceURIUpdate>(
    baseEvent(SERVICE_REGISTRY, [
      addressParam("addr", addr),
      stringParam("serviceURI", serviceURI),
    ])
  );
}

// ---------------------------------------------------------------------------
// Polls
// ---------------------------------------------------------------------------

export function createPollCreatedEvent(
  poll: Address,
  proposal: Bytes,
  endBlock: BigInt,
  quorum: BigInt,
  quota: BigInt
): PollCreated {
  return changetype<PollCreated>(
    baseEvent(POLL_CREATOR, [
      addressParam("poll", poll),
      bytesParam("proposal", proposal),
      uintParam("endBlock", endBlock),
      uintParam("quorum", quorum),
      uintParam("quota", quota),
    ])
  );
}

export function createVoteEvent(voter: Address, choiceID: BigInt): Vote {
  return changetype<Vote>(
    baseEvent(POLL, [addressParam("voter", voter), uintParam("choiceID", choiceID)])
  );
}

// ---------------------------------------------------------------------------
// Treasury (LivepeerGovernor)
// ---------------------------------------------------------------------------

export function createProposalCreatedEvent(
  proposalId: BigInt,
  proposer: Address,
  targets: Array<Address>,
  values: Array<BigInt>,
  calldatas: Array<Bytes>,
  voteStart: BigInt,
  voteEnd: BigInt,
  description: string
): ProposalCreated {
  let signatures = new Array<string>(targets.length).fill("");
  return changetype<ProposalCreated>(
    baseEvent(LIVEPEER_GOVERNOR, [
      uintParam("proposalId", proposalId),
      addressParam("proposer", proposer),
      new ethereum.EventParam("targets", ethereum.Value.fromAddressArray(targets)),
      new ethereum.EventParam(
        "values",
        ethereum.Value.fromUnsignedBigIntArray(values)
      ),
      new ethereum.EventParam(
        "signatures",
        ethereum.Value.fromStringArray(signatures)
      ),
      new ethereum.EventParam(
        "calldatas",
        ethereum.Value.fromBytesArray(calldatas)
      ),
      uintParam("voteStart", voteStart),
      uintParam("voteEnd", voteEnd),
      stringParam("description", description),
    ])
  );
}

export function createVoteCastEvent(
  voter: Address,
  proposalId: BigInt,
  support: i32,
  weight: BigInt,
  reason: string
): VoteCast {
  return changetype<VoteCast>(
    baseEvent(LIVEPEER_GOVERNOR, [
      addressParam("voter", voter),
      uintParam("proposalId", proposalId),
      i32Param("support", support),
      uintParam("weight", weight),
      stringParam("reason", reason),
    ])
  );
}

export function createVoteCastWithParamsEvent(
  voter: Address,
  proposalId: BigInt,
  support: i32,
  weight: BigInt,
  reason: string,
  params: Bytes
): VoteCastWithParams {
  return changetype<VoteCastWithParams>(
    baseEvent(LIVEPEER_GOVERNOR, [
      addressParam("voter", voter),
      uintParam("proposalId", proposalId),
      i32Param("support", support),
      uintParam("weight", weight),
      stringParam("reason", reason),
      bytesParam("params", params),
    ])
  );
}
