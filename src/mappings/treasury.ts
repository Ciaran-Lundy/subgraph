import { BigDecimal, BigInt, ethereum, log } from "@graphprotocol/graph-ts";

import {
  convertToDecimal,
  createOrLoadProtocol,
  createOrLoadRound,
  createOrLoadTransactionFromEvent,
  createOrUpdateLivepeerAccount,
  getBlockNum,
  makeEventId,
  ZERO_BD,
} from "../../utils/helpers";
import {
  TreasuryProposal,
  TreasuryVote,
  TreasuryVoteEvent,
} from "../types/schema";
import {
  ProposalCanceled,
  ProposalCreated,
  ProposalExecuted,
  ProposalQueued,
  SetController,
  VoteCast,
  VoteCastWithParams,
} from "../types/Treasury/LivepeerGovernor";
import { recordSetController } from "./common";

// Workaround: Graph entities store enums as strings (no string enums in AS/codegen).
namespace TreasurySupport {
  export const Against = "Against";
  export const For = "For";
  export const Abstain = "Abstain";
}

namespace TreasuryProposalStatus {
  export const Pending = "Pending";
  export const Canceled = "Canceled";
  export const Queued = "Queued";
  export const Executed = "Executed";
}

export function proposalCreated(event: ProposalCreated): void {
  const p = event.params;
  const proposer = createOrUpdateLivepeerAccount(
    p.proposer.toHex(),
    event.block.timestamp.toI32()
  );

  const proposal = new TreasuryProposal(p.proposalId.toString());
  proposal.proposer = proposer.id;
  proposal.targets = p.targets.map<string>((t) => t.toHex());
  proposal.values = p.values;
  proposal.calldatas = p.calldatas;
  proposal.voteStart = p.voteStart;
  proposal.voteEnd = p.voteEnd;
  proposal.description = p.description;
  proposal.status = TreasuryProposalStatus.Pending;
  proposal.forVotes = ZERO_BD;
  proposal.againstVotes = ZERO_BD;
  proposal.abstainVotes = ZERO_BD;
  proposal.totalVotes = ZERO_BD;
  proposal.save();
}

export function voteCast(event: VoteCast): void {
  handleVote(
    event,
    event.params.proposalId,
    event.params.voter.toHex(),
    event.params.support,
    event.params.weight,
    event.params.reason
  );
}

export function voteCastWithParams(event: VoteCastWithParams): void {
  handleVote(
    event,
    event.params.proposalId,
    event.params.voter.toHex(),
    event.params.support,
    event.params.weight,
    event.params.reason
  );
}

function handleVote(
  event: ethereum.Event,
  proposalId: BigInt,
  voter: string,
  support: i32,
  weightRaw: BigInt,
  reason: string
): void {
  const proposal = TreasuryProposal.load(proposalId.toString());

  if (!proposal) {
    log.error("Treasury vote for unknown proposal {}", [proposalId.toString()]);
    return;
  }

  const supportLabelValue = supportFromValue(support);
  if (supportLabelValue == null) {
    return;
  }
  const supportLabel = supportLabelValue as string;

  const account = createOrUpdateLivepeerAccount(
    voter,
    event.block.timestamp.toI32()
  );
  let protocol = createOrLoadProtocol();
  const round = createOrLoadRound(
    protocol,
    getBlockNum(protocol, event.block)
  );
  const transaction = createOrLoadTransactionFromEvent(event);
  const voteId = proposal.id.concat("-").concat(voter);
  let vote = TreasuryVote.load(voteId);
  const weight = convertToDecimal(weightRaw);

  if (!vote) {
    vote = new TreasuryVote(voteId);
    vote.proposal = proposal.id;
    vote.voter = account.id;
  }

  vote.support = supportLabel;
  vote.weight = weight;
  vote.reason = reason.length > 0 ? reason : null;
  vote.save();

  increaseProposalTotals(proposal, supportLabel, weight);

  proposal.save();

  const voteEvent = new TreasuryVoteEvent(
    makeEventId(event.transaction.hash, event.logIndex)
  );
  voteEvent.transaction = transaction.id;
  voteEvent.timestamp = event.block.timestamp.toI32();
  voteEvent.round = round.id;
  voteEvent.voter = account.id;
  voteEvent.proposal = proposal.id;
  voteEvent.support = supportLabel;
  voteEvent.weight = weight;
  voteEvent.reason = reason.length > 0 ? reason : null;
  voteEvent.save();
}

function supportFromValue(value: i32): string | null {
  if (value == 0) return TreasurySupport.Against;
  if (value == 1) return TreasurySupport.For;
  if (value == 2) return TreasurySupport.Abstain;
  return null;
}

function increaseProposalTotals(
  proposal: TreasuryProposal,
  support: string,
  weight: BigDecimal
): void {
  if (support == TreasurySupport.For) {
    proposal.forVotes = proposal.forVotes.plus(weight);
  } else if (support == TreasurySupport.Against) {
    proposal.againstVotes = proposal.againstVotes.plus(weight);
  } else {
    proposal.abstainVotes = proposal.abstainVotes.plus(weight);
  }
  proposal.totalVotes = proposal.totalVotes.plus(weight);
}

export function proposalCanceled(event: ProposalCanceled): void {
  setProposalStatus(event.params.proposalId, TreasuryProposalStatus.Canceled);
}

export function proposalQueued(event: ProposalQueued): void {
  const proposal = setProposalStatus(
    event.params.proposalId,
    TreasuryProposalStatus.Queued
  );
  if (proposal) {
    proposal.eta = event.params.eta;
    proposal.save();
  }
}

export function proposalExecuted(event: ProposalExecuted): void {
  setProposalStatus(event.params.proposalId, TreasuryProposalStatus.Executed);
}

export function setController(event: SetController): void {
  recordSetController(event, event.params.controller);
}

function setProposalStatus(
  proposalId: BigInt,
  status: string
): TreasuryProposal | null {
  const proposal = TreasuryProposal.load(proposalId.toString());
  if (!proposal) {
    log.error("Treasury status update for unknown proposal {}", [
      proposalId.toString(),
    ]);
    return null;
  }
  proposal.status = status;
  proposal.save();
  return proposal;
}
