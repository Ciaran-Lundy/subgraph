import { ethers } from "hardhat";
import {
  BigNumber,
  BigNumberish,
  BytesLike,
  constants,
  Overrides,
  Signer,
  Wallet,
} from "ethers";
import { expect } from "chai";
import {
  RoundsManager__factory as RoundsManagerFactory,
  LivepeerToken__factory as LivepeerTokenFactory,
  BondingManager__factory as BondingManagerFactory,
  Poll__factory as PollFactory,
  Controller__factory as ControllerFactory,
  TicketBroker__factory as TicketBrokerFactory,
  RoundsManager,
  LivepeerToken,
  BondingManager,
  TicketBroker,
} from "../typechain-types";
import { createApolloFetch } from "apollo-fetch";
import * as path from "path";
import { execSync } from "child_process";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import PollCreatorArtifact from "./fixtures/PollCreator.json";

const controllerAddress = "0x77A0865438f2EfD65667362D4a8937537CA7a5EF";

const PERC_DIVISOR = 1000000;
const PERC_MULTIPLIER = PERC_DIVISOR / 100;

const ONE_ETHER = ethers.utils.parseEther("1");
const LPT = (amount: number) => ethers.utils.parseEther(amount.toString());

const defaults: Overrides = { gasLimit: 1000000 };

const srcDir = path.join(__dirname, "..");

let graphNodeIP = "127.0.0.1";
if (process.env.DOCKER) {
  graphNodeIP = "graph-node";
}

const fetchSubgraph = createApolloFetch({
  uri: `http://${graphNodeIP}:8000/subgraphs/name/livepeer/livepeer`,
});

// Fixed keys so that accounts beyond the devchain's four unlocked ones, and
// the PollCreator address in networks.yaml (development), are deterministic
const testWallet = (name: string) =>
  new Wallet(
    ethers.utils.keccak256(
      ethers.utils.toUtf8Bytes(`livepeer-subgraph-test:${name}`)
    ),
    ethers.provider
  );

type Ticket = {
  recipient: string;
  sender: string;
  faceValue: BigNumberish;
  winProb: BigNumberish;
  senderNonce: BigNumberish;
  recipientRandHash: BytesLike;
  auxData: BytesLike;
};

const contractId = (contractName) => {
  return ethers.utils.solidityKeccak256(["string"], [contractName]);
};

const exec = (cmd) => {
  try {
    return execSync(cmd, { cwd: srcDir, stdio: "inherit" });
  } catch (e) {
    throw new Error(`Failed to run command \`${cmd}\``);
  }
};

// Subgraph BigDecimal (LPT/ETH units) as wei
const toWei = (value: string | null | undefined) =>
  ethers.utils.parseEther(value ?? "0");

// Wait until the subgraph has indexed the chain head as of this call, failing
// fast if it hit an indexing error
const waitForSync = async () => {
  const target = await ethers.provider.getBlockNumber();
  const deadline = Date.now() + 300 * 1000;
  for (;;) {
    try {
      const result = await fetchSubgraph({
        query: `{ _meta { block { number } hasIndexingErrors } }`,
      });
      const meta = result?.data?._meta;
      if (meta?.hasIndexingErrors) {
        throw new Error("Subgraph has indexing errors");
      }
      if (meta && meta.block.number >= target) {
        return;
      }
    } catch (e) {
      if (e.message === "Subgraph has indexing errors") {
        throw e;
      }
    }
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for the subgraph to reach ${target}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
};

describe("Token contract", function () {
  let RoundsManager: RoundsManager;
  let BondingManager: BondingManager;
  let Token: LivepeerToken;
  let TicketBroker: TicketBroker;

  let bondingManagerAddress: string;
  let pollAddress: string;

  let broadcaster: SignerWithAddress;
  let transcoder1: SignerWithAddress;
  let transcoder2: SignerWithAddress;
  let delegator1: SignerWithAddress;
  const delegator2 = testWallet("delegator2");
  const delegator3 = testWallet("delegator3");
  const delegator4 = testWallet("delegator4");
  const delegator5 = testWallet("delegator5");
  const delegator6 = testWallet("delegator6");
  const pollCreatorDeployer = testWallet("pollCreatorDeployer");
  // Ticket sender: the devchain's unlocked accounts cannot sign messages
  const ticketSender = testWallet("broadcaster");

  let roundLength: BigNumber;

  // address -> choiceID for every account that voted
  const votes: { [address: string]: number } = {};

  describe("Deployment", function () {
    const mineBlocks = async (blocks: number) => {
      const initialBlock = await ethers.provider.getBlockNumber();

      await new Promise<void>((resolve) => {
        const onBlock = (blockNumber) => {
          if (blockNumber >= initialBlock + blocks) {
            ethers.provider.off("block", onBlock);
            resolve();
          }
        };
        ethers.provider.on("block", onBlock);
      });
    };

    const waitUntilBlock = async (blockNumber: number) => {
      const latestBlock = await ethers.provider.getBlockNumber();
      if (blockNumber > latestBlock) {
        await mineBlocks(blockNumber - latestBlock);
      }
    };

    // Wait for the next round to start, then initialize it. Initializing at
    // the start leaves the whole round before the lock period, during which
    // transcoder() reverts.
    const mineAndInitializeRound = async (_roundLength) => {
      const round = await RoundsManager.currentRound();
      while ((await RoundsManager.currentRound()).eq(round)) {
        await mineBlocks(1);
      }
      await ensureRoundInitialized();
    };

    const send = async (tx: Promise<any>) => (await tx).wait();

    // BondingManager calls revert in a round that has started but is not
    // initialized. Avoid the end of a round too: transcoder() reverts in the
    // lock period, and the round must not roll over before the next
    // transaction is mined.
    const ensureRoundInitialized = async () => {
      const length = (await RoundsManager.roundLength()).toNumber();
      const start = (
        await RoundsManager.lastRoundLengthUpdateStartBlock()
      ).toNumber();
      const block = await ethers.provider.getBlockNumber();
      // 10% lock period (5 blocks) plus a margin
      if (length - ((block - start) % length) <= 8) {
        const round = await RoundsManager.currentRound();
        while ((await RoundsManager.currentRound()).eq(round)) {
          await mineBlocks(1);
        }
      }
      if (!(await RoundsManager.currentRoundInitialized())) {
        await send(RoundsManager.initializeRound(defaults));
      }
    };

    const bond = async (signer: Signer, amount: BigNumber, to: string) => {
      await send(
        Token.connect(signer).approve(bondingManagerAddress, amount, defaults)
      );
      await ensureRoundInitialized();
      await send(BondingManager.connect(signer).bond(amount, to, defaults));
    };

    const createWinningTicket = async (
      recipient: { address: string },
      sender: { address: string },
      recipientRand: number,
      faceValue: BigNumberish = 0
    ) => {
      const recipientRandHash = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(["uint256"], [recipientRand])
      );
      const currentRound = await RoundsManager.currentRound();
      const currentRoundBlockHash = await RoundsManager.blockHashForRound(
        currentRound
      );

      const ticket: Ticket = {
        recipient: recipient.address,
        sender: sender.address,
        faceValue,
        winProb: constants.MaxUint256.toString(),
        senderNonce: 0,
        recipientRandHash,
        auxData: ethers.utils.defaultAbiCoder.encode(
          ["uint256", "bytes32"],
          [currentRound.toNumber(), currentRoundBlockHash]
        ),
      };

      return ticket;
    };

    // TicketBroker.getTicketHash()
    const ticketHash = (ticket: Ticket) =>
      ethers.utils.solidityKeccak256(
        [
          "address",
          "address",
          "uint256",
          "uint256",
          "uint256",
          "bytes32",
          "bytes",
        ],
        [
          ticket.recipient,
          ticket.sender,
          ticket.faceValue,
          ticket.winProb,
          ticket.senderNonce,
          ticket.recipientRandHash,
          ticket.auxData,
        ]
      );

    const pendingStake = async (address: string) =>
      BondingManager.pendingStake(address, await RoundsManager.currentRound());

    // Expected tally from contract state: a registered transcoder votes with
    // its total stake minus the stake of its delegators that voted themselves
    const tallyPollAndCheckResult = async () => {
      const expected = [BigNumber.from(0), BigNumber.from(0)];
      const voters = Object.keys(votes);

      for (const voter of voters) {
        let voteStake: BigNumber;
        if (await BondingManager.isRegisteredTranscoder(voter)) {
          voteStake = await BondingManager.transcoderTotalStake(voter);
          for (const other of voters) {
            if (other === voter) continue;
            const otherData = await BondingManager.getDelegator(other);
            if (
              otherData.delegateAddress.toLowerCase() === voter &&
              !(await BondingManager.isRegisteredTranscoder(other))
            ) {
              voteStake = voteStake.sub(await pendingStake(other));
            }
          }
        } else {
          voteStake = await pendingStake(voter);
        }
        expected[votes[voter]] = expected[votes[voter]].add(voteStake);
      }

      const result = await fetchSubgraph({
        query: `{ poll(id: "${pollAddress.toLowerCase()}") { tally { yes no } } }`,
      });
      const tally = result.data.poll.tally;

      expect(toWei(tally?.yes).toString()).to.equal(expected[0].toString());
      expect(toWei(tally?.no).toString()).to.equal(expected[1].toString());
    };

    const vote = async (signer: Signer, choiceID: number) => {
      const Poll = PollFactory.connect(pollAddress, signer);
      await send(Poll.vote(choiceID, defaults));
      votes[(await signer.getAddress()).toLowerCase()] = choiceID;
    };

    before(async () => {
      [broadcaster, transcoder1, transcoder2, delegator1] =
        await ethers.getSigners();

      const Controller = ControllerFactory.connect(
        controllerAddress,
        broadcaster
      );

      const getContractAddress = async (contractName: string) =>
        Controller.getContract(contractId(contractName));

      const roundsManagerAddress = await getContractAddress("RoundsManager");
      bondingManagerAddress = await getContractAddress("BondingManager");
      const livepeerTokenAddress = await getContractAddress("LivepeerToken");
      const ticketBrokerAddress = await getContractAddress("TicketBroker");

      RoundsManager = RoundsManagerFactory.connect(
        roundsManagerAddress,
        broadcaster
      );
      BondingManager = BondingManagerFactory.connect(
        bondingManagerAddress,
        broadcaster
      );
      Token = LivepeerTokenFactory.connect(livepeerTokenAddress, broadcaster);
      TicketBroker = TicketBrokerFactory.connect(
        ticketBrokerAddress,
        broadcaster
      );

      await send(RoundsManager.setRoundLength(50, defaults));
      roundLength = await RoundsManager.roundLength();

      // Fund every test account with LPT, and the fixed-key wallets with ETH
      for (const account of [transcoder1, transcoder2, delegator1]) {
        await send(Token.transfer(account.address, LPT(5000), defaults));
      }
      for (const wallet of [
        delegator2,
        delegator3,
        delegator4,
        delegator5,
        delegator6,
        pollCreatorDeployer,
        ticketSender,
      ]) {
        await send(
          broadcaster.sendTransaction({
            to: wallet.address,
            value: ONE_ETHER.mul(10),
          })
        );
        await send(Token.transfer(wallet.address, LPT(5000), defaults));
      }

      // Deploy the PollCreator the development manifest points at
      const PollCreator = new ethers.ContractFactory(
        PollCreatorArtifact.abi,
        PollCreatorArtifact.bytecode,
        pollCreatorDeployer
      );
      const pollCreatorAddress = ethers.utils.getContractAddress({
        from: pollCreatorDeployer.address,
        nonce: 0,
      });
      if ((await ethers.provider.getCode(pollCreatorAddress)) === "0x") {
        const deployed = await PollCreator.deploy(bondingManagerAddress);
        await deployed.deployed();
        expect(deployed.address).to.equal(pollCreatorAddress);
      }

      // fund the broadcaster reserve and deposit
      await send(
        TicketBroker.connect(ticketSender).fundDepositAndReserve(
          ONE_ETHER,
          ONE_ETHER,
          { ...defaults, value: ONE_ETHER.mul(2) }
        )
      );

      await mineAndInitializeRound(roundLength);

      // Register transcoders 1 and 2 (50% reward cut, 5% fee share)
      for (const transcoder of [transcoder1, transcoder2]) {
        await bond(transcoder, LPT(1000), transcoder.address);
        await ensureRoundInitialized();
        await send(
          BondingManager.connect(transcoder).transcoder(
            50 * PERC_MULTIPLIER,
            5 * PERC_MULTIPLIER,
            defaults
          )
        );
      }

      // Delegators 1-3 delegate to transcoder 1
      for (const delegator of [delegator1, delegator2, delegator3]) {
        await bond(delegator, LPT(300), transcoder1.address);
      }

      await mineAndInitializeRound(roundLength);

      // Create and deploy the subgraph
      exec("yarn prepare:development");
      exec("yarn codegen");

      if (process.env.DOCKER) {
        exec(`yarn create:docker`);
        exec(`yarn deploy:docker`);
      } else {
        exec(`yarn create:local`);
        exec(`yarn deploy:local`);
      }
    });

    it("subgraph does not fail", async () => {
      await waitForSync();

      const result = await fetchSubgraph({
        query: `{ protocol(id: "0") { roundCount totalSupply } }`,
      });
      expect(result.data.protocol.roundCount).to.be.greaterThan(0);
      expect(toWei(result.data.protocol.totalSupply).gt(0)).to.equal(true);
    });

    it("correctly updates the broadcaster deposit when ticket value is less than deposit", async () => {
      const faceValue = ethers.utils.parseEther(".2");

      // Tickets carry the current round's block hash, which only exists once
      // the round is initialized
      await ensureRoundInitialized();
      const ticket = await createWinningTicket(
        transcoder1,
        ticketSender,
        1,
        faceValue
      );
      const signedTicketHash = await ticketSender.signMessage(
        ethers.utils.arrayify(ticketHash(ticket))
      );

      await expect(
        TicketBroker.connect(transcoder1).redeemWinningTicket(
          ticket,
          signedTicketHash,
          1,
          defaults
        )
      ).to.emit(TicketBroker, "WinningTicketRedeemed");

      await waitForSync();

      const result = await fetchSubgraph({
        query: `{
          broadcaster(id: "${ticketSender.address.toLowerCase()}") {
            deposit
            reserve
            totalVolumeETH
          }
          winningTicketRedeemedEvents { faceValue }
          transcoder(id: "${transcoder1.address.toLowerCase()}") {
            totalVolumeETH
            lastFeeRound { id }
          }
        }`,
      });
      const { broadcaster: b, winningTicketRedeemedEvents, transcoder } =
        result.data;

      expect(winningTicketRedeemedEvents).to.have.length(1);
      expect(toWei(winningTicketRedeemedEvents[0].faceValue)).to.deep.equal(
        faceValue
      );
      expect(toWei(b.deposit)).to.deep.equal(ONE_ETHER.sub(faceValue));
      expect(toWei(b.reserve)).to.deep.equal(ONE_ETHER);
      expect(toWei(b.totalVolumeETH)).to.deep.equal(faceValue);
      expect(toWei(transcoder.totalVolumeETH)).to.deep.equal(faceValue);
      expect(transcoder.lastFeeRound.id).to.equal(
        (await RoundsManager.currentRound()).toString()
      );
    });

    it("counts bonded delegators and moves lastActiveStakeUpdateRound", async () => {
      const result = await fetchSubgraph({
        query: `{
          protocol(id: "0") { delegatorsCount }
          transcoder(id: "${transcoder1.address.toLowerCase()}") {
            delegatorCount
            lastActiveStakeUpdateRound
          }
        }`,
      });
      // transcoders 1 and 2 (self-bonded) plus delegators 1-3
      expect(result.data.protocol.delegatorsCount).to.equal("5");
      // transcoder 1 itself plus delegators 1-3
      expect(result.data.transcoder.delegatorCount).to.equal("4");

      // Bonding to an active transcoder moves it to currentRound + 1
      await bond(delegator1, LPT(1), transcoder1.address);
      await waitForSync();
      const after = await fetchSubgraph({
        query: `{ transcoder(id: "${transcoder1.address.toLowerCase()}") { lastActiveStakeUpdateRound } }`,
      });
      expect(after.data.transcoder.lastActiveStakeUpdateRound).to.equal(
        (await RoundsManager.currentRound()).add(1).toString()
      );
    });

    it("creates a poll", async () => {
      const PollCreator = new ethers.Contract(
        ethers.utils.getContractAddress({
          from: pollCreatorDeployer.address,
          nonce: 0,
        }),
        PollCreatorArtifact.abi,
        transcoder1
      );
      const hash = ethers.utils.toUtf8Bytes(
        "QmWBPdeDCi8uxQrUyTV38xwaeYxgmjQmx1Zkiw4vgQhj7x"
      );
      await send(PollCreator.createPoll(hash, defaults));
      await waitForSync();

      const pollData = await fetchSubgraph({
        query: `{ polls { id } }`,
      });
      expect(pollData.data.polls.length).to.equal(1);
      pollAddress = pollData.data.polls[0].id;
    });

    it("correctly indexes vote choices", async () => {
      await vote(transcoder1, 0);
      await vote(delegator1, 1);
      await vote(delegator2, 0);
      await vote(delegator3, 1);
      await waitForSync();

      const result = await fetchSubgraph({
        query: `{ votes(where: { poll: "${pollAddress.toLowerCase()}" }) { voter choiceID } }`,
      });
      const choices = ["Yes", "No"];
      const indexed = {};
      for (const v of result.data.votes) {
        indexed[v.voter] = v.choiceID;
      }
      for (const voter of Object.keys(votes)) {
        expect(indexed[voter]).to.equal(choices[votes[voter]]);
      }
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after transcoder 1 calls reward", async () => {
      await mineAndInitializeRound(roundLength);
      await ensureRoundInitialized();
      await send(BondingManager.connect(transcoder1).reward(defaults));
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after transcoder 2 calls reward", async () => {
      await ensureRoundInitialized();
      await send(BondingManager.connect(transcoder2).reward(defaults));
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after transcoder bonds", async () => {
      await bond(transcoder1, LPT(100), transcoder1.address);
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after transcoder unbonds", async () => {
      await ensureRoundInitialized();
      await send(BondingManager.connect(transcoder1).unbond(LPT(100), defaults));
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after transcoder rebonds", async () => {
      await ensureRoundInitialized();
      await send(BondingManager.connect(transcoder1).rebond(0, defaults));
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after delegator bonds", async () => {
      await bond(delegator1, LPT(100), transcoder1.address);
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after delegator unbonds", async () => {
      await ensureRoundInitialized();
      await send(BondingManager.connect(delegator1).unbond(LPT(100), defaults));
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after delegator rebonds", async () => {
      await ensureRoundInitialized();
      await send(BondingManager.connect(delegator1).rebond(0, defaults));
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after delegator claims earnings", async () => {
      await mineAndInitializeRound(roundLength);
      await ensureRoundInitialized();
      await send(BondingManager.connect(transcoder1).reward(defaults));
      const currentRound = await RoundsManager.currentRound();
      await ensureRoundInitialized();
      await send(
        BondingManager.connect(delegator1).claimEarnings(currentRound, defaults)
      );
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after delegator that has not voted bonds to a transcoder that has", async () => {
      await bond(delegator4, LPT(100), transcoder1.address);
      await mineAndInitializeRound(roundLength);
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after delegator that has not voted unbonds from a transcoder that has", async () => {
      await ensureRoundInitialized();
      await send(BondingManager.connect(delegator4).unbond(LPT(50), defaults));
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after delegator that has not voted rebonds to a transcoder that has", async () => {
      await ensureRoundInitialized();
      await send(BondingManager.connect(delegator4).rebond(0, defaults));
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after delegator 1 switches from transcoder 1 to transcoder 2", async () => {
      await bond(delegator1, LPT(100), transcoder2.address);
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after delegator 5 bonds with unregistered transcoder (delegate 2)", async () => {
      await bond(delegator5, LPT(100), delegator2.address);
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after delegator 2 registers as transcoder and inherits the voting power of delegator 5", async () => {
      // delegator 2 moves its own stake from transcoder 1 to itself
      await bond(delegator2, LPT(100), delegator2.address);
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after delegator 5 votes and overrides its delegate vote", async () => {
      await vote(delegator5, 1);
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after delegator 5 claims earnings", async () => {
      await mineAndInitializeRound(roundLength);
      await ensureRoundInitialized();
      await send(BondingManager.connect(transcoder1).reward(defaults));
      const currentRound = await RoundsManager.currentRound();
      await ensureRoundInitialized();
      await send(
        BondingManager.connect(delegator5).claimEarnings(currentRound, defaults)
      );
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after delegator moves stake to a transcoder that voted", async () => {
      await bond(delegator1, LPT(100), transcoder1.address);
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after transcoder 1 resigns", async () => {
      // unbond() claims pending rewards first, so unbond the pending stake
      const stake = await pendingStake(transcoder1.address);
      await ensureRoundInitialized();
      await send(BondingManager.connect(transcoder1).unbond(stake, defaults));
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after delegator with zero voting power votes", async () => {
      await vote(delegator6, 1);
      await waitForSync();
      await tallyPollAndCheckResult();
    });

    it("correctly tallies poll after polling period is over", async () => {
      const result = await fetchSubgraph({
        query: `{ poll(id: "${pollAddress.toLowerCase()}") { endBlock } }`,
      });
      const tallyBefore = await fetchSubgraph({
        query: `{ poll(id: "${pollAddress.toLowerCase()}") { tally { yes no } } }`,
      });

      // Fast forward past the end block; bonding changes after it must not
      // move the final tally
      await waitUntilBlock(parseInt(result.data.poll.endBlock) + 1);
      await bond(delegator3, LPT(100), transcoder2.address);
      await waitForSync();

      const tallyAfter = await fetchSubgraph({
        query: `{ poll(id: "${pollAddress.toLowerCase()}") { tally { yes no } } }`,
      });
      expect(tallyAfter.data.poll.tally).to.deep.equal(
        tallyBefore.data.poll.tally
      );
    });
  });
});
