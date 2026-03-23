

require("dotenv").config();
const {
  Client,
  PrivateKey,
  AccountId,
  ContractCreateFlow,
  ContractFunctionParameters,
  ContractCallQuery,
  ContractExecuteTransaction,
  Hbar,
  TokenId,
  TransferTransaction,
  Long,
} = require("@hashgraph/sdk");
const fs   = require("fs");
const path = require("path");

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const OPERATOR_ID  = AccountId.fromString(process.env.HEDERA_OPERATOR_ID  || "0.0.5020213");
const OPERATOR_KEY = PrivateKey.fromString(process.env.HEDERA_OPERATOR_KEY || "3030020100300706052b8104000a042204208c640114faada2b897121544aedaa96b488632f4e9a90488ec0b0140790ea655");

const SAUCE_EVM       = "0x0000000000000000000000000000000000120f46";
const SAUCE_HEDERA_ID = "0.0.1183558";
const WHBAR_EVM       = "0x0000000000000000000000000000000000003ad2";
const PENALTY_TREASURY = "0xa809c5e6f65363ff61a89d5518356c0efff4b28c";

// 50 SAUCE at 8 decimals — safely within your ~64 SAUCE balance
const SAUCE_FUND_AMOUNT = "5000000000";

function loadBytecode(filename) {
  const p = path.join(__dirname, filename);
  if (!fs.existsSync(p)) throw new Error(`Bytecode not found: ${p}`);
  return fs.readFileSync(p);
}

function countdown(label, totalMs) {
  return new Promise(resolve => {
    const interval = 5_000;
    let elapsed = 0;
    process.stdout.write(` ${label}: 0s elapsed`);
    const timer = setInterval(() => {
      elapsed += interval;
      const remaining = Math.max(0, totalMs - elapsed);
      process.stdout.write(`\r ${label}: ${elapsed / 1000}s elapsed, ${remaining / 1000}s remaining...`);
      if (elapsed >= totalMs) {
        clearInterval(timer);
        process.stdout.write("\n");
        resolve();
      }
    }, interval);
  });
}

async function main() {
  const client = Client.forTestnet().setOperator(OPERATOR_ID, OPERATOR_KEY);
  const operatorEvm = '0xa809c5e6f65363ff61a89d5518356c0efff4b28c';

  console.log("\n=== SAUCE STAKING: DEPLOY → FUND → STAKE → PREVIEW → UNSTAKE ===\n");

  try {
    // ══════════════════════════════════════════════════════════════
    // 1. Deploy SauceStaking
    // ══════════════════════════════════════════════════════════════
    console.log("1. Deploying SauceStaking...");
    const deployReceipt = await (
      await new ContractCreateFlow()
        .setBytecode(loadBytecode("RemitMinter.bin"))
        .setGas(6_000_000)
        .setMaxAutomaticTokenAssociations(50)
        .setConstructorParameters(
          new ContractFunctionParameters()
            .addAddress(WHBAR_EVM)
            .addAddress(PENALTY_TREASURY)
        )
        .setInitialBalance(new Hbar(10))
        .execute(client)
    ).getReceipt(client);

    const contractId  = deployReceipt.contractId;
    const contractEvm = `0x${contractId.toSolidityAddress()}`;
    console.log(` Contract ID : ${contractId}`);
    console.log(` EVM         : ${contractEvm}\n`);

    // ══════════════════════════════════════════════════════════════
    // 2. Check operator SAUCE balance before proceeding
    // ══════════════════════════════════════════════════════════════
    console.log("2. Checking operator SAUCE balance...");
    const balRes  = await fetch(
      `https://testnet.mirrornode.hedera.com/api/v1/accounts/${OPERATOR_ID}/tokens?token.id=${SAUCE_HEDERA_ID}`
    );
    const balData = await balRes.json();
    const sauceBal = balData.tokens?.[0]?.balance ?? "0";
    console.log(` SAUCE balance  : ${sauceBal} tinySAUCE (~${(Number(sauceBal) / 1e8).toFixed(4)} SAUCE)`);
    console.log(` Funding amount : ${SAUCE_FUND_AMOUNT} tinySAUCE (~${(Number(SAUCE_FUND_AMOUNT) / 1e8).toFixed(4)} SAUCE)`);
    if (BigInt(sauceBal) < BigInt(SAUCE_FUND_AMOUNT)) {
      throw new Error(
        `Insufficient SAUCE: have ${sauceBal} tinySAUCE, need ${SAUCE_FUND_AMOUNT} tinySAUCE`
      );
    }
    console.log(" Balance OK ✓\n");

    // ══════════════════════════════════════════════════════════════
    // 3. setSauceToken — registers SAUCE and self-associates contract
    // ══════════════════════════════════════════════════════════════
    console.log("3. setSauceToken (also associates contract with SAUCE)...");
    await (
      await new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(14_000_000)
        .setFunction("setSauceToken", new ContractFunctionParameters()
          .addAddress(SAUCE_EVM)
          .addUint8(8)
        )
        .execute(client)
    ).getReceipt(client);
    console.log(" Done ✓\n");

    // ══════════════════════════════════════════════════════════════
    // 4. Send SAUCE directly to contract via TransferTransaction
    //    No allowance needed — this is a plain HTS token transfer
    // ══════════════════════════════════════════════════════════════
    console.log(`4. Sending ${Number(SAUCE_FUND_AMOUNT) / 1e8} SAUCE directly to contract...`);
    const contractAsAccount = AccountId.fromString(contractId.toString());
    const fundAmount        = Long.fromString(SAUCE_FUND_AMOUNT);

    const transferTx = await new TransferTransaction()
      .addTokenTransfer(TokenId.fromString(SAUCE_HEDERA_ID), OPERATOR_ID,        fundAmount.negate())
      .addTokenTransfer(TokenId.fromString(SAUCE_HEDERA_ID), contractAsAccount,  fundAmount)
      .freezeWith(client)
      .sign(OPERATOR_KEY);

    await (await transferTx.execute(client)).getReceipt(client);
    console.log(" Transferred ✓ — SAUCE now in contract account\n");

    // ══════════════════════════════════════════════════════════════
    // 5. Credit the reward pool counter on-chain
    // ══════════════════════════════════════════════════════════════
    console.log("5. Crediting reward pool counter on contract...");
    await (
      await new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(80_000)
        .setFunction("fundSauceRewards", new ContractFunctionParameters()
          .addUint256(SAUCE_FUND_AMOUNT)
        )
        .execute(client)
    ).getReceipt(client);
    console.log(` sauceRewardPool = ${Number(SAUCE_FUND_AMOUNT) / 1e8} SAUCE ✓\n`);

    // ══════════════════════════════════════════════════════════════
    // 6. Stake 5 HBAR into T30 (2%/min, 30-min lock)
    // ══════════════════════════════════════════════════════════════
    console.log("6. Staking 5 HBAR into T30 (2%/min, 30-min lock)...");
    await (
      await new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(400_000)
        .setPayableAmount(new Hbar(5))
        .setFunction("stake", new ContractFunctionParameters()
          .addUint8(0)  // StakeType.HBAR
          .addUint256(0)
          .addUint8(1)  // Tier.T30
        )
        .execute(client)
    ).getReceipt(client);
    console.log(" Staked ✓ — position index 0\n");

    // ══════════════════════════════════════════════════════════════
    // 7. Immediate preview — expect 0 (no full minute elapsed)
    // ══════════════════════════════════════════════════════════════
    console.log("7. previewReward immediately after staking...");
    const preview0  = await new ContractCallQuery()
      .setContractId(contractId)
      .setGas(100_000)
      .setFunction("previewReward", new ContractFunctionParameters()
        .addAddress(operatorEvm)
        .addUint256(0)
      )
      .execute(client);
    console.log(` Accrued (t=0s) : ${preview0.getUint256(0)} tinySAUCE — expected 0\n`);

    // ══════════════════════════════════════════════════════════════
    // 8. Wait 2 minutes
    // ══════════════════════════════════════════════════════════════
    console.log("8. Waiting 2 minutes for rewards to accumulate...");
    await countdown("Accumulating", 2 * 60 * 1000);

    // ══════════════════════════════════════════════════════════════
    // 9. Preview after 2 minutes — expect ~0.2 SAUCE
    //    5 HBAR × 2% × 2 min = 0.2 SAUCE
    // ══════════════════════════════════════════════════════════════
    console.log("9. previewReward after 2 minutes...");
    const preview1    = await new ContractCallQuery()
      .setContractId(contractId)
      .setGas(100_000)
      .setFunction("previewReward", new ContractFunctionParameters()
        .addAddress(operatorEvm)
        .addUint256(0)
      )
      .execute(client);
    const reward1     = preview1.getUint256(0);
    const reward1Fmt  = (Number(reward1) / 1e8).toFixed(4);
    console.log(` Accrued (t=2min) : ${reward1} tinySAUCE = ${reward1Fmt} SAUCE`);
    console.log(` Expected         : ~0.2000 SAUCE (5 HBAR × 2% × 2 min)\n`);

    // ══════════════════════════════════════════════════════════════
    // 10. Unstake early — 10% penalty, zero SAUCE reward
    // ══════════════════════════════════════════════════════════════
    console.log("10. unstake — position 0 (early exit, inside 30-min lock)...");
    await (
      await new ContractExecuteTransaction()
        .setContractId(contractId)
        .setGas(400_000)
        .setFunction("unstake", new ContractFunctionParameters()
          .addUint256(0)
        )
        .execute(client)
    ).getReceipt(client);
    console.log(" Unstaked ✓");
    console.log(" 0.5 HBAR  → penalty treasury");
    console.log(" 4.5 HBAR  → operator wallet");
    console.log(" 0 SAUCE   → forfeited (early exit)\n");

    // ══════════════════════════════════════════════════════════════
    // SUMMARY
    // ══════════════════════════════════════════════════════════════
    console.log("═".repeat(60));
    console.log("✅ DONE");
    console.log(` Contract  : ${contractId}`);
    console.log(` EVM       : ${contractEvm}`);
    console.log(" Flow:");
    console.log("  1  Deploy SauceStaking");
    console.log("  2  Check operator SAUCE balance");
    console.log("  3  setSauceToken → self-associates contract");
    console.log(`  4  Transfer ${Number(SAUCE_FUND_AMOUNT) / 1e8} SAUCE directly to contract`);
    console.log("  5  fundSauceRewards → credits pool counter");
    console.log("  6  stake 5 HBAR → T30");
    console.log("  7  previewReward → 0 tinySAUCE (t=0)");
    console.log("  8  wait 2 minutes");
    console.log("  9  previewReward → ~0.2 SAUCE");
    console.log(" 10  unstake early → 4.5 HBAR back, 0 SAUCE (penalty)");
    console.log("");
    console.log(" Tip: wait the full 30 min before unstaking to collect SAUCE");
    console.log("═".repeat(60));

  } catch (err) {
    console.error("\n❌ ERROR:", err.message);
    if (err.status) console.error(" Status:", err.status?._code);
    console.error(err.stack?.split("\n").slice(0, 5).join("\n"));
  } finally {
    client.close();
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});