import { describe, expect, it, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface Proposal {
  creator: string;
  description: string;
  startHeight: number;
  endHeight: number;
  yesVotes: number;
  noVotes: number;
  executed: boolean;
  voteType: number;
}

interface Vote {
  yes: boolean;
  amount: number;
}

interface Stake {
  amount: number;
  lockUntil: number;
}

interface ContractState {
  balances: Map<string, number>;
  allowances: Map<{ owner: string; spender: string }, number>;
  minters: Map<string, boolean>;
  proposals: Map<number, Proposal>;
  votes: Map<{ proposalId: number; voter: string }, Vote>;
  stakes: Map<string, Stake>;
  rewards: Map<string, number>;
  totalSupply: number;
  paused: boolean;
  admin: string;
  nextProposalId: number;
  rewardPool: number;
}

// Mock contract implementation
class GovernanceTokenMock {
  protected state: ContractState = {
    balances: new Map([["contract-owner", 1000000000000]]),
    allowances: new Map(),
    minters: new Map(),
    proposals: new Map(),
    votes: new Map(),
    stakes: new Map(),
    rewards: new Map(),
    totalSupply: 1000000000000,
    paused: false,
    admin: "contract-owner",
    nextProposalId: 1,
    rewardPool: 0,
  };

  private ERR_UNAUTHORIZED = 100;
  private ERR_PAUSED = 101;
  private ERR_INVALID_AMOUNT = 102;
  private ERR_INVALID_RECIPIENT = 103;
  private ERR_INVALID_PROPOSAL = 104;
  private ERR_ALREADY_VOTED = 105;
  private ERR_PROPOSAL_ENDED = 106;
  private ERR_NOT_ENOUGH_VOTES = 107;
  private ERR_INVALID_STAKE = 108;
  private ERR_STAKE_LOCKED = 109;
  private ERR_NO_REWARDS = 110;
  private ERR_PROPOSAL_ACTIVE = 111;
  private ERR_MAX_PROPOSALS_REACHED = 112;
  private ERR_INVALID_VOTE_TYPE = 113;

  private TOKEN_NAME = "CrossManuAllianceToken";
  private TOKEN_SYMBOL = "CMAT";
  private TOKEN_DECIMALS = 6;
  private PROPOSAL_QUORUM = 10;
  private PROPOSAL_DURATION = 1440;
  private STAKE_LOCK_PERIOD = 144;
  private MAX_PROPOSALS = 100;
  private VOTE_LINEAR = 1;
  private VOTE_QUADRATIC = 2;

  private currentBlockHeight = 1000; // Mock block height

  setBlockHeight(height: number) {
    this.currentBlockHeight = height;
  }

  getName(): ClarityResponse<string> {
    return { ok: true, value: this.TOKEN_NAME };
  }

  getSymbol(): ClarityResponse<string> {
    return { ok: true, value: this.TOKEN_SYMBOL };
  }

  getDecimals(): ClarityResponse<number> {
    return { ok: true, value: this.TOKEN_DECIMALS };
  }

  getTotalSupply(): ClarityResponse<number> {
    return { ok: true, value: this.state.totalSupply };
  }

  getBalance(account: string): ClarityResponse<number> {
    return { ok: true, value: this.state.balances.get(account) ?? 0 };
  }

  transfer(sender: string, amount: number, from: string, recipient: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (sender !== from) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    if (recipient === "invalid") {
      return { ok: false, value: this.ERR_INVALID_RECIPIENT };
    }
    const senderBalance = this.state.balances.get(from) ?? 0;
    if (senderBalance < amount) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    this.state.balances.set(from, senderBalance - amount);
    const recipientBalance = this.state.balances.get(recipient) ?? 0;
    this.state.balances.set(recipient, recipientBalance + amount);
    return { ok: true, value: true };
  }

  setAdmin(caller: string, newAdmin: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.admin = newAdmin;
    return { ok: true, value: true };
  }

  pause(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = true;
    return { ok: true, value: true };
  }

  unpause(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.paused = false;
    return { ok: true, value: true };
  }

  addMinter(caller: string, minter: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.minters.set(minter, true);
    return { ok: true, value: true };
  }

  removeMinter(caller: string, minter: string): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.minters.set(minter, false);
    return { ok: true, value: true };
  }

  mint(caller: string, amount: number, recipient: string): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (!this.state.minters.get(caller)) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const recipientBalance = this.state.balances.get(recipient) ?? 0;
    this.state.balances.set(recipient, recipientBalance + amount);
    this.state.totalSupply += amount;
    return { ok: true, value: true };
  }

  stakeTokens(caller: string, amount: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (amount <= 0) {
      return { ok: false, value: this.ERR_INVALID_STAKE };
    }
    const callerBalance = this.state.balances.get(caller) ?? 0;
    if (callerBalance < amount) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    this.state.balances.set(caller, callerBalance - amount);
    const currentStake = this.state.stakes.get(caller) ?? { amount: 0, lockUntil: 0 };
    this.state.stakes.set(caller, { amount: currentStake.amount + amount, lockUntil: this.currentBlockHeight + this.STAKE_LOCK_PERIOD });
    return { ok: true, value: true };
  }

  unstakeTokens(caller: string, amount: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const currentStake = this.state.stakes.get(caller);
    if (!currentStake || currentStake.amount < amount) {
      return { ok: false, value: this.ERR_INVALID_STAKE };
    }
    if (this.currentBlockHeight < currentStake.lockUntil) {
      return { ok: false, value: this.ERR_STAKE_LOCKED };
    }
    this.state.stakes.set(caller, { ...currentStake, amount: currentStake.amount - amount });
    const callerBalance = this.state.balances.get(caller) ?? 0;
    this.state.balances.set(caller, callerBalance + amount);
    return { ok: true, value: true };
  }

  getStake(account: string): ClarityResponse<Stake | undefined> {
    return { ok: true, value: this.state.stakes.get(account) };
  }

  createProposal(caller: string, description: string, voteType: number): ClarityResponse<number> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (this.state.nextProposalId > this.MAX_PROPOSALS) {
      return { ok: false, value: this.ERR_MAX_PROPOSALS_REACHED };
    }
    if (voteType !== this.VOTE_LINEAR && voteType !== this.VOTE_QUADRATIC) {
      return { ok: false, value: this.ERR_INVALID_VOTE_TYPE };
    }
    const callerBalance = this.state.balances.get(caller) ?? 0;
    if (callerBalance < 1000000) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const proposalId = this.state.nextProposalId;
    this.state.proposals.set(proposalId, {
      creator: caller,
      description,
      startHeight: this.currentBlockHeight,
      endHeight: this.currentBlockHeight + this.PROPOSAL_DURATION,
      yesVotes: 0,
      noVotes: 0,
      executed: false,
      voteType,
    });
    this.state.nextProposalId += 1;
    return { ok: true, value: proposalId };
  }

  voteProposal(caller: string, proposalId: number, yes: boolean, amount: number): ClarityResponse<boolean> {
    if (this.state.paused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) {
      return { ok: false, value: this.ERR_INVALID_PROPOSAL };
    }
    if (this.currentBlockHeight >= proposal.endHeight) {
      return { ok: false, value: this.ERR_PROPOSAL_ENDED };
    }
    const voteKey = { proposalId, voter: caller };
    if (this.state.votes.has(voteKey)) {
      return { ok: false, value: this.ERR_ALREADY_VOTED };
    }
    const stake = this.state.stakes.get(caller);
    if (!stake || stake.amount < amount) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    let voteWeight = amount;
    if (proposal.voteType === this.VOTE_QUADRATIC) {
      voteWeight = Math.floor(Math.sqrt(amount));
    }
    this.state.votes.set(voteKey, { yes, amount: voteWeight });
    if (yes) {
      this.state.proposals.set(proposalId, { ...proposal, yesVotes: proposal.yesVotes + voteWeight });
    } else {
      this.state.proposals.set(proposalId, { ...proposal, noVotes: proposal.noVotes + voteWeight });
    }
    return { ok: true, value: true };
  }

  endProposal(proposalId: number): ClarityResponse<boolean> {
    const proposal = this.state.proposals.get(proposalId);
    if (!proposal) {
      return { ok: false, value: this.ERR_INVALID_PROPOSAL };
    }
    if (this.currentBlockHeight < proposal.endHeight) {
      return { ok: false, value: this.ERR_PROPOSAL_ACTIVE };
    }
    if (proposal.executed) {
      return { ok: false, value: this.ERR_ALREADY_VOTED };
    }
    const totalVotes = proposal.yesVotes + proposal.noVotes;
    if (proposal.yesVotes <= proposal.noVotes || totalVotes < (this.state.totalSupply * this.PROPOSAL_QUORUM / 100)) {
      return { ok: false, value: this.ERR_NOT_ENOUGH_VOTES };
    }
    this.state.proposals.set(proposalId, { ...proposal, executed: true });
    return { ok: true, value: true };
  }

  getProposal(proposalId: number): ClarityResponse<Proposal | undefined> {
    return { ok: true, value: this.state.proposals.get(proposalId) };
  }

  getVote(proposalId: number, voter: string): ClarityResponse<Vote | undefined> {
    return { ok: true, value: this.state.votes.get({ proposalId, voter }) };
  }

  distributeRewards(caller: string, amount: number): ClarityResponse<boolean> {
    if (caller !== this.state.admin) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.rewardPool += amount;
    this.state.rewards.set(caller, (this.state.rewards.get(caller) ?? 0) + amount);
    return { ok: true, value: true };
  }

  claimRewards(caller: string): ClarityResponse<number> {
    const pending = this.state.rewards.get(caller) ?? 0;
    if (pending <= 0) {
      return { ok: false, value: this.ERR_NO_REWARDS };
    }
    this.state.rewards.delete(caller);
    const callerBalance = this.state.balances.get(caller) ?? 0;
    this.state.balances.set(caller, callerBalance + pending);
    return { ok: true, value: pending };
  }
}

// Test setup
const accounts = {
  owner: "contract-owner",
  admin: "admin",
  minter: "minter",
  user1: "user1",
  user2: "user2",
};

describe("GovernanceToken Contract", () => {
  let contract: GovernanceTokenMock;

  beforeEach(() => {
    contract = new GovernanceTokenMock();
    contract.setBlockHeight(1000);
  });

  it("should initialize with correct token metadata", () => {
    expect(contract.getName()).toEqual({ ok: true, value: "CrossManuAllianceToken" });
    expect(contract.getSymbol()).toEqual({ ok: true, value: "CMAT" });
    expect(contract.getDecimals()).toEqual({ ok: true, value: 6 });
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 1000000000000 });
  });

  it("should allow admin to add minter", () => {
    contract.setAdmin(accounts.owner, accounts.admin);
    const addMinter = contract.addMinter(accounts.admin, accounts.minter);
    expect(addMinter).toEqual({ ok: true, value: true });
  });

  it("should prevent non-admin from adding minter", () => {
    const addMinter = contract.addMinter(accounts.user1, accounts.minter);
    expect(addMinter).toEqual({ ok: false, value: 100 });
  });

  it("should allow minter to mint tokens", () => {
    contract.addMinter(accounts.owner, accounts.minter);
    const mintResult = contract.mint(accounts.minter, 1000000, accounts.user1);
    expect(mintResult).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 1000000 });
    expect(contract.getTotalSupply()).toEqual({ ok: true, value: 1000000000000 + 1000000 });
  });

  it("should prevent non-minter from minting", () => {
    const mintResult = contract.mint(accounts.user1, 1000000, accounts.user1);
    expect(mintResult).toEqual({ ok: false, value: 100 });
  });

  it("should allow token transfer", () => {
    contract.transfer(accounts.owner, 1000000, accounts.owner, accounts.user1);
    const transferResult = contract.transfer(accounts.user1, 500000, accounts.user1, accounts.user2);
    expect(transferResult).toEqual({ ok: true, value: true });
    expect(contract.getBalance(accounts.user1)).toEqual({ ok: true, value: 500000 });
    expect(contract.getBalance(accounts.user2)).toEqual({ ok: true, value: 500000 });
  });

  it("should prevent transfer of insufficient balance", () => {
    const transferResult = contract.transfer(accounts.user1, 1000000, accounts.user1, accounts.user2);
    expect(transferResult).toEqual({ ok: false, value: 102 });
  });

  it("should fail to vote on invalid proposal", () => {
    contract.transfer(accounts.owner, 100000000, accounts.owner, accounts.user1);
    contract.stakeTokens(accounts.user1, 100000000);
    const vote = contract.voteProposal(accounts.user1, 999, true, 100000000);
    expect(vote).toEqual({ ok: false, value: 104 }); // ERR_INVALID_PROPOSAL
  });

  it("should pause and unpause contract", () => {
    const pauseResult = contract.pause(accounts.owner);
    expect(pauseResult).toEqual({ ok: true, value: true });

    const mintDuringPause = contract.mint(accounts.owner, 1000000, accounts.user1);
    expect(mintDuringPause).toEqual({ ok: false, value: 101 });

    const unpauseResult = contract.unpause(accounts.owner);
    expect(unpauseResult).toEqual({ ok: true, value: true });
  });

  it("should distribute and claim rewards", () => {
    const distribute = contract.distributeRewards(accounts.owner, 1000000);
    expect(distribute).toEqual({ ok: true, value: true });

    const claim = contract.claimRewards(accounts.owner);
    expect(claim).toEqual({ ok: true, value: 1000000 });
    expect(contract.getBalance(accounts.owner)).toEqual({ ok: true, value: 1000000000000 + 1000000 });
  });

  it("should fail to claim rewards when none exist", () => {
    const claim = contract.claimRewards(accounts.user1);
    expect(claim).toEqual({ ok: false, value: 110 });
  });

  it("should fail to end active proposal", () => {
    contract.transfer(accounts.owner, 100000000, accounts.owner, accounts.user1);
    contract.createProposal(accounts.user1, "Active Proposal", 1);
    const endResult = contract.endProposal(1);
    expect(endResult).toEqual({ ok: false, value: 111 });
  });
});