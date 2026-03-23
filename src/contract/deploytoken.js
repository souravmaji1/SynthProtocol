

// SPDX-License-Identifier: MIT
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
  Status,
  TokenAssociateTransaction,
  TokenId,
} = require("@hashgraph/sdk");
const fs = require("fs");
const path = require("path");

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const OPERATOR_ID  = AccountId.fromString(process.env.HEDERA_OPERATOR_ID  || "0.0.5020213");
const OPERATOR_KEY = PrivateKey.fromString(process.env.HEDERA_OPERATOR_KEY || "3030020100300706052b8104000a042204208c640114faada2b897121544aedaa96b488632f4e9a90488ec0b0140790ea655");

const CHAINLINK_HBAR_USD_TESTNET = "0x59bC155EB6c6C415fE43255aF66EcF0523c92B4a";

const MINT_HBAR_AMOUNT   = new Hbar(20);
const SLIPPAGE_TOLERANCE = 9500n;
const CREATE_TOKEN_FEE   = new Hbar(25);

// ─── HELPERS ─────────────────────────────────────────────────────────────────
function loadBytecode(filename = "RemitMinter.bin") {
  const fullPath = path.join(__dirname, filename);
  if (!fs.existsSync(fullPath)) throw new Error(`❌ Bytecode not found: ${fullPath}`);
  return fs.readFileSync(fullPath);
}

function formatMirrorTxId(txId) {
  const txStr = txId.toString();
  let formatted = txStr.replace("@", "-");
  formatted = formatted.replace(/\.(\d+)$/, "-$1");
  return formatted;
}

function tokenIdToEvmAddress(tokenId) {
  const num = parseInt(tokenId.split(".")[2], 10);
  return "0x" + num.toString(16).padStart(40, "0");
}

async function waitForTokenCreation(txId, maxAttempts = 12, initialDelayMs = 5000) {
  const formattedId = formatMirrorTxId(txId);
  const url = `https://testnet.mirrornode.hedera.com/api/v1/transactions/${formattedId}`;

  console.log(`   Querying Mirror Node: ${url}`);
  console.log(`   Waiting ${initialDelayMs / 1000}s before first poll...`);
  await new Promise(r => setTimeout(r, initialDelayMs));

  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);

      if (res.status === 404) {
        console.log(`   Mirror attempt ${i + 1}/${maxAttempts}: not indexed yet (404)`);
      } else if (!res.ok) {
        throw new Error(`Unexpected HTTP ${res.status}`);
      } else {
        const data = await res.json();
        const transactions = data.transactions ?? [];

        const tokenCreationTx = transactions.find(
          tx => tx.name === "TOKENCREATION" && tx.entity_id
        );

        if (tokenCreationTx) {
          const tokenHederaId   = tokenCreationTx.entity_id;
          const tokenEvmAddress = tokenIdToEvmAddress(tokenHederaId);
          console.log(`   Mirror Node success on attempt ${i + 1}`);
          return { tokenHederaId, tokenEvmAddress, formattedId };
        }

        console.log(`   Mirror attempt ${i + 1}/${maxAttempts}: transactions found but TOKENCREATION not yet present`);
      }
    } catch (e) {
      console.log(`   Mirror attempt ${i + 1}/${maxAttempts} error: ${e.message}`);
    }

    const delay = Math.min(2000 * Math.pow(1.5, i), 10000);
    console.log(`   Retrying in ${(delay / 1000).toFixed(1)}s...`);
    await new Promise(r => setTimeout(r, delay));
  }

  throw new Error(`TOKENCREATION child not found after ${maxAttempts} attempts (~60s)`);
}

// ─── MAIN ────────────────────────────────────────────────────────────────────
async function main() {
  const client = Client.forTestnet().setOperator(OPERATOR_ID, OPERATOR_KEY);

  console.log("\n=== 🚀 SynthMinter DEPLOY + CREATE TOKEN (Fixed Mirror Node) ===\n");

  try {
    // 1. Deploy contract
    console.log("1. Deploying SynthMinter...");
    const bytecode = loadBytecode();

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
    const contractId     = deployReceipt.contractId;
    const contractEvm    = `0x${contractId.toSolidityAddress()}`;

    console.log(`✅ SynthMinter deployed!`);
    console.log(`   Contract ID : ${contractId}`);
    console.log(`   EVM address : ${contractEvm}\n`);

    // 2. Create sUSD token
    console.log("2. Creating sUSD synth token...");

    const createParams = new ContractFunctionParameters()
      .addString("Synthetic USD")
      .addString("sUSD")
      .addString("Test synthetic USD on Hedera")
      .addUint8(6)
      .addInt64(0)
      .addUint256(1000000);

    const createTx = new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(1500000)
      .setPayableAmount(CREATE_TOKEN_FEE)
      .setFunction("createSynthToken", createParams);

    const createResponse = await createTx.execute(client);
    const createTxId     = createResponse.transactionId;
    const createReceipt  = await createResponse.getReceipt(client);

    console.log(`   createSynthToken status: ${createReceipt.status}`);

    if (createReceipt.status._code !== Status.Success._code) {
      throw new Error("Token creation failed on consensus node");
    }

    // 3. Get token address from Mirror Node child TOKENCREATION tx
    console.log("3. Fetching token ID from Mirror Node (TOKENCREATION child tx)...");
    const { tokenHederaId, tokenEvmAddress, formattedId } = await waitForTokenCreation(createTxId);

    console.log(`✅ sUSD token created!`);
    console.log(`   Token Hedera ID   : ${tokenHederaId}`);
    console.log(`   Token EVM address : ${tokenEvmAddress}`);
    console.log(`   Mirror Tx link    : https://testnet.hashscan.io/transaction/${formattedId}\n`);

    // 4. Associate operator account with the sUSD token
    // Must happen before the account can receive any minted tokens
    console.log("4. Associating operator account with sUSD token...");

    const associateTx = await new TokenAssociateTransaction()
      .setAccountId(OPERATOR_ID)
      .setTokenIds([TokenId.fromString(tokenHederaId)])
      .freezeWith(client)
      .sign(OPERATOR_KEY);

    const associateResponse = await associateTx.execute(client);
    const associateReceipt  = await associateResponse.getReceipt(client);

    console.log(`   Association status: ${associateReceipt.status}`);

    if (associateReceipt.status._code !== Status.Success._code) {
      throw new Error("Token association failed");
    }

    console.log(`✅ Operator account ${OPERATOR_ID} associated with ${tokenHederaId}\n`);

    // 5. Read HBAR price
    console.log("5. Reading HBAR price...");
    const priceQuery = await new ContractCallQuery()
      .setContractId(contractId)
      .setGas(180000)
      .setQueryPayment(new Hbar(2))
      .setFunction("getHBARPrice")
      .execute(client);

    const priceRaw = priceQuery.getUint256(0);
    console.log(`   HBAR/USD (8 dec): ${priceRaw} ≈ $${(Number(priceRaw) / 1e8).toFixed(5)}\n`);

    // 6. Preview mint
    console.log("6. Preview mint...");
    const previewParams = new ContractFunctionParameters()
      .addAddress(tokenEvmAddress)
      .addUint256(MINT_HBAR_AMOUNT.toTinybars());

    const previewRes = await new ContractCallQuery()
      .setContractId(contractId)
      .setGas(300000)
      .setQueryPayment(new Hbar(1))
      .setFunction("previewMint", previewParams)
      .execute(client);

    // getInt64 returns a Long object — must call .toString() before BigInt()
    const expectedSynthLong = previewRes.getInt64(0);
    const expectedSynth     = BigInt(expectedSynthLong.toString());

    console.log(`   For ${MINT_HBAR_AMOUNT} HBAR → ≈ ${expectedSynth} sUSD units\n`);

    // 7. Mint with slippage protection
    console.log("7. Minting with slippage protection...");
    const minAccept = (expectedSynth * SLIPPAGE_TOLERANCE) / 10000n;

    const mintParams = new ContractFunctionParameters()
      .addAddress(tokenEvmAddress)
      .addInt64(minAccept.toString());

    const mintTx = new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(800000)
      .setPayableAmount(MINT_HBAR_AMOUNT)
      .setFunction("mintSynth", mintParams);

    const mintResponse = await mintTx.execute(client);
    const mintReceipt  = await mintResponse.getReceipt(client);

    console.log(`   mintSynth status: ${mintReceipt.status}`);
    if (mintReceipt.status._code === Status.Success._code) {
      console.log("   ✅ Mint success! Tokens should be in your account.");
    }

    console.log("\n" + "═".repeat(80));
    console.log("🎉 Deployment & mint completed");
    console.log(`   SynthMinter     : ${contractId} (${contractEvm})`);
    console.log(`   sUSD Token ID   : ${tokenHederaId}`);
    console.log(`   sUSD Token EVM  : ${tokenEvmAddress}`);
    console.log(`   Mirror Tx       : https://testnet.mirrornode.hedera.com/api/v1/transactions/${formattedId}`);
    console.log("═".repeat(80));

  } catch (err) {
    console.error("\n❌ ERROR:", err.message);
    if (err.status) console.error("Status code:", err.status._code);
    console.error(err.stack?.split("\n").slice(0, 8).join("\n"));
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});


