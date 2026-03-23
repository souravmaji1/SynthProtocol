const {
  Client,
  PrivateKey,
  AccountId,
  Hbar,
  ContractCreateFlow,
  ContractFunctionParameters,
} = require("@hashgraph/sdk");

const fs   = require("fs");
const path = require("path");

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const OPERATOR_ID  = process.env.HEDERA_OPERATOR_ID  || "0.0.5020213";
const OPERATOR_KEY = process.env.HEDERA_OPERATOR_KEY || "3030020100300706052b8104000a042204208c640114faada2b897121544aedaa96b488632f4e9a90488ec0b0140790ea655";

const PLATFORM_FEE_BPS = 250; // 2.5% — change as needed
const CHAINLINK_HBAR_USD_TESTNET = "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a";

// ─────────────────────────────────────────────────────────────────────────────

async function deployCoreContract(client) {
  console.log("─".repeat(60));
  console.log("📦 Step 1 — Deploying AIFreelanceMarketplace (Core)...");
  console.log("─".repeat(60));

  const bytecodePath = path.join(__dirname, "RemitMinter.bin");
  if (!fs.existsSync(bytecodePath)) {
    throw new Error(
      `AIFreelanceMarketplace.bin not found at ${bytecodePath}.\n` +
      `Compile first:\n` +
      `  solc --bin --abi AIFreelanceMarketplace.sol -o . --base-path . --include-path node_modules`
    );
  }

  const bytecode = fs.readFileSync(bytecodePath);
  console.log(`   Bytecode loaded (${bytecode.length} bytes)`);
  console.log(`   Constructor arg: platformFeeBps = ${PLATFORM_FEE_BPS} (${PLATFORM_FEE_BPS / 100}%)\n`);


    const deployFlow = new ContractCreateFlow()
      .setBytecode(bytecode)
      .setGas(14000000)
      .setMaxAutomaticTokenAssociations(50)
      .setConstructorParameters(
        new ContractFunctionParameters().addAddress(CHAINLINK_HBAR_USD_TESTNET)
      )
      .setInitialBalance(new Hbar(5));

    const deployResponse = await deployFlow.execute(client);
    const deployReceipt  = await deployResponse.getReceipt(client);
    contractId = deployReceipt.contractId;
    contractEvm = `0x${contractId.toSolidityAddress()}`;

    console.log(`✅ SynthMinter deployed!`);
    console.log(`   Contract ID : ${contractId}`);
    console.log(`   EVM address : ${contractEvm}\n`);


  

  if (!contractId) throw new Error("Core deployment failed — no contractId in receipt");

  const evmAddress = `0x${contractId.toSolidityAddress()}`;

  console.log("✅ AIFreelanceMarketplace deployed!");
  console.log(`   Contract ID  : ${contractId}`);
  console.log(`   EVM Address  : ${evmAddress}\n`);

  return { contractId, evmAddress };
}



// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const operatorId  = AccountId.fromString(OPERATOR_ID);
  const operatorKey = PrivateKey.fromString(OPERATOR_KEY);
  const client      = Client.forTestnet().setOperator(operatorId, operatorKey);

  try {
    console.log("\n🚀 Deploying AIFreelance Marketplace to Hedera Testnet\n");

    // ── 1. Core contract (no dependency) ─────────────────────────
    const core = await deployCoreContract(client);

   
    // ── Summary ───────────────────────────────────────────────────
    console.log("═".repeat(60));
    console.log("🎉 Both contracts deployed successfully!\n");
    console.log("   CORE  (write calls) :");
    console.log(`     Hedera ID  : ${core.contractId}`);
    console.log(`     EVM address: ${core.evmAddress}`);
    console.log("\n   READER (read calls) :");
    console.log(`     Hedera ID  : ${reader.contractId}`);
    console.log(`     EVM address: ${reader.evmAddress}`);
    console.log("═".repeat(60));

    console.log("\n📋 Next steps:");
    console.log(`   1. Set CORE_CONTRACT_ID=${core.contractId} in your .env`);
    console.log(`   2. Set CORE_EVM_ADDRESS=${core.evmAddress} in your .env`);
    console.log(`   3. Set READER_CONTRACT_ID=${reader.contractId} in your .env`);
    console.log(`   4. Set READER_EVM_ADDRESS=${reader.evmAddress} in your .env`);
    console.log(`   5. Call whitelistToken() on the core contract to enable a payment token`);
    console.log(`   6. Point write txns → CORE, read queries → READER\n`);

    // ── Save deployment info ──────────────────────────────────────
    const deployInfo = {
      network:     "hedera-testnet",
      deployedAt:  new Date().toISOString(),
      operator:    OPERATOR_ID,
      platformFeeBps: PLATFORM_FEE_BPS,
      core: {
        contract:   "AIFreelanceMarketplace",
        contractId: core.contractId.toString(),
        evmAddress: core.evmAddress,
      },
      reader: {
        contract:   "MarketplaceReader",
        contractId: reader.contractId.toString(),
        evmAddress: reader.evmAddress,
      },
    };

    const outPath = path.join(__dirname, "marketplace.deployment.json");
    fs.writeFileSync(outPath, JSON.stringify(deployInfo, null, 2));
    console.log(`💾 Deployment info saved to marketplace.deployment.json\n`);

  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error("\n❌ Deployment failed:", err.message);
  process.exit(1);
});

