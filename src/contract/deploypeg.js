
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
  AccountAllowanceApproveTransaction,
  Status,
  Long,
  TokenAssociateTransaction,
  TokenId,
  TransferTransaction,
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

// ─── NEW CONFIG FOR STREAM DEMO ─────────────────────────────────────────────
const RECIPIENT_ID       = OPERATOR_ID;               // ← change to real recipient AccountId
const RECIPIENT_EVM      = "0xa809c5e6f65363ff61a89d5518356c0efff4b28c";


const STREAM_AMOUNT_PER_SECOND = "100";               // string is safest & clearest
const INITIAL_DEPOSIT_AMOUNT   = "5000";
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
        console.log(`   Mirror attempt ${i + 1}/${maxAttempts}: TOKENCREATION not yet present`);
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

  console.log("\n=== 🚀 SynthMinter DEPLOY + CREATE TOKEN + MINT + STREAM DEMO ===\n");

  let contractId, contractEvm, tokenHederaId, tokenEvmAddress, formattedId;

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
    contractId = deployReceipt.contractId;
    contractEvm = `0x${contractId.toSolidityAddress()}`;

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
      throw new Error("Token creation failed");
    }

    // 3. Wait for token ID via mirror node
    console.log("3. Fetching token ID from Mirror Node...");
    ({ tokenHederaId, tokenEvmAddress, formattedId } = await waitForTokenCreation(createTxId));

    console.log(`✅ sUSD created!`);
    console.log(`   Token Hedera ID   : ${tokenHederaId}`);
    console.log(`   Token EVM address : ${tokenEvmAddress}\n`);

    // 4. Associate operator with token
    console.log("4. Associating operator account with sUSD...");
    const associateTx = await new TokenAssociateTransaction()
      .setAccountId(OPERATOR_ID)
      .setTokenIds([TokenId.fromString(tokenHederaId)])
      .freezeWith(client)
      .sign(OPERATOR_KEY);

    const assocResp = await associateTx.execute(client);
    const assocReceipt = await assocResp.getReceipt(client);
    console.log(`   Association status: ${assocReceipt.status}\n`);

    // 5. Mint sUSD
    console.log("5. Minting sUSD...");
    const priceQuery = await new ContractCallQuery()
      .setContractId(contractId)
      .setGas(180000)
      .setQueryPayment(new Hbar(2))
      .setFunction("getHBARPrice")
      .execute(client);

    const priceRaw = priceQuery.getUint256(0);
    console.log(`   HBAR/USD (8 dec): ${priceRaw} ≈ $${(Number(priceRaw) / 1e8).toFixed(5)}\n`);

    const previewParams = new ContractFunctionParameters()
      .addAddress(tokenEvmAddress)
      .addUint256(MINT_HBAR_AMOUNT.toTinybars());

    const previewRes = await new ContractCallQuery()
      .setContractId(contractId)
      .setGas(300000)
      .setQueryPayment(new Hbar(1))
      .setFunction("previewMint", previewParams)
      .execute(client);

    const expectedSynth = BigInt(previewRes.getInt64(0).toString());
    console.log(`   Expected sUSD: ${expectedSynth.toString()} units\n`);

    const minAccept = (expectedSynth * SLIPPAGE_TOLERANCE) / 10000n;

    const mintTx = new ContractExecuteTransaction()
      .setContractId(contractId)
      .setGas(800000)
      .setPayableAmount(MINT_HBAR_AMOUNT)
      .setFunction("mintSynth", new ContractFunctionParameters()
        .addAddress(tokenEvmAddress)
        .addInt64(minAccept.toString())
      );

    const mintResponse = await mintTx.execute(client);
    const mintReceipt = await mintResponse.getReceipt(client);
    console.log(`   Mint status: ${mintReceipt.status}\n`);

    if (mintReceipt.status._code !== Status.Success._code) {
      throw new Error("Mint failed");
    }

    // 5.5. APPROVE SynthMinter to spend operator's sUSD (REQUIRED!)
// 5.5. Approving SynthMinter to spend sUSD...
console.log("5.5. Approving SynthMinter to spend sUSD...");
console.log(
  `   → Allowing spender (contract) address: ${contractEvm} to spend up to ${INITIAL_DEPOSIT_AMOUNT} sUSD`
);

const tokenIdObjs = TokenId.fromString(tokenHederaId);

// FIXED: Create AccountId from the contract's EVM address properly
// The contract's solidity address needs to be converted to AccountId
const contractAccountId = AccountId.fromEvmAddress(0, 0, contractEvm);

const approveTx = new AccountAllowanceApproveTransaction()
  .approveTokenAllowance(
    tokenIdObjs,              // token ID
    OPERATOR_ID,               // owner
    contractAccountId,         // spender (contract as AccountId)
    Long.fromString(INITIAL_DEPOSIT_AMOUNT)
  )
  .freezeWith(client);

const signedTx = await approveTx.sign(OPERATOR_KEY);
const approveResp = await signedTx.execute(client);
const approveReceipt = await approveResp.getReceipt(client);

console.log(`   Approval status: ${approveReceipt.status}\n`);

if (approveReceipt.status._code !== Status.Success._code) {
  throw new Error("Token approval failed");
}



    // ────────────────────────────────────────────────────────────────
    //               NEW: STREAM DEMONSTRATION
    // ────────────────────────────────────────────────────────────────

// 6. Start stream + deposit (ATOMIC - no separate transfer needed)
console.log("6. Starting sUSD payment stream with deposit...");
const startStreamParams = new ContractFunctionParameters()
  .addAddress(tokenEvmAddress)                    // tokenAddress
  .addAddress(RECIPIENT_EVM)                      // recipient  
  .addUint256(STREAM_AMOUNT_PER_SECOND)           // 100 units/second
  .addUint256(INITIAL_DEPOSIT_AMOUNT);            // 5000 total deposit

const startTx = new ContractExecuteTransaction()
  .setContractId(contractId)
  .setGas(500000)  // ↑ increased gas
  .setFunction("startStreamWithDeposit", startStreamParams);  // ← NEW FUNCTION

const startResp = await startTx.execute(client);
const startReceipt = await startResp.getReceipt(client);
console.log(`   startStreamWithDeposit status: ${startReceipt.status}`);

if (startReceipt.status._code !== Status.Success._code) {
  throw new Error("startStreamWithDeposit failed");
}
console.log("✅ Stream started + funded atomically!\n");



   

    if (startReceipt.status._code !== Status.Success._code) {
      throw new Error("startStream failed");
    }

    // 7. Transfer tokens from operator → contract to actually fund the stream
 // 7. Transfer tokens from operator → contract to actually fund the stream
console.log(`7. Transferring ${INITIAL_DEPOSIT_AMOUNT} sUSD to SynthMinter contract...`);

const tokenIdObj = TokenId.fromString(tokenHederaId);

// Convert ContractId → AccountId (this is the key fix)
const contractAsAccount = AccountId.fromString(contractId.toString());

// FIXED: Use Long.fromString() for both positive & negative amounts
const depositAmount = Long.fromString(INITIAL_DEPOSIT_AMOUNT);  // 5000 as Long

const transferTx = await new TransferTransaction()
  .addTokenTransfer(tokenIdObj, OPERATOR_ID, depositAmount.negate())  // -5000 from you  
  .addTokenTransfer(tokenIdObj, contractAsAccount, depositAmount)     // +5000 to contract
  .freezeWith(client)
  .sign(OPERATOR_KEY);

const transferResp = await transferTx.execute(client);
const transferReceipt = await transferResp.getReceipt(client);
console.log(`   Token transfer to contract status: ${transferReceipt.status}\n`);

// Check claimable amount first
const claimableQuery = await new ContractCallQuery()
  .setContractId(contractId)
  .setGas(200000)
  .setQueryPayment(new Hbar(1))
  .setFunction("getClaimable", 
    new ContractFunctionParameters()
      .addAddress("0xa809c5e6f65363ff61a89d5518356c0efff4b28c")
      .addAddress(tokenEvmAddress)
  )
  .execute(client);

const claimable = claimableQuery.getUint256(0);
console.log(`   Claimable now: ${claimable} sUSD units`);


    // 8. Wait 10 seconds for stream to accrue, then claim
console.log("8. Waiting 10s for stream accrual, then claiming...");
await new Promise(r => setTimeout(r, 40000));  // 10 second delay

const claimParams = new ContractFunctionParameters()
  .addAddress("0xa809c5e6f65363ff61a89d5518356c0efff4b28c")   // streamer = operator
  .addAddress(tokenEvmAddress);

const claimTx = new ContractExecuteTransaction()
  .setContractId(contractId)
  .setGas(350000)
  .setFunction("claimStream", claimParams);

const claimResp = await claimTx.execute(client);
const claimReceipt = await claimResp.getReceipt(client);
console.log(`   claimStream status: ${claimReceipt.status}`);


    console.log("\n" + "═".repeat(80));
    console.log("🎉 Full flow completed (deploy → mint → stream → claim demo)");
    console.log(`   SynthMinter     : ${contractId} (${contractEvm})`);
    console.log(`   sUSD Token      : ${tokenHederaId} (${tokenEvmAddress})`);
    console.log(`   Stream active   : ${OPERATOR_ID} → ${RECIPIENT_ID}`);
    console.log(`   Rate            : ${STREAM_AMOUNT_PER_SECOND} units / second`);
    console.log(`   Initial deposit : ${INITIAL_DEPOSIT_AMOUNT} units`);
    console.log("═".repeat(80));

  } catch (err) {
    console.error("\n❌ ERROR:", err.message);
    if (err.status) console.error("Status code:", err.status?._code);
    console.error(err.stack?.split("\n").slice(0, 6).join("\n"));
  } finally {
    client.close();
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

