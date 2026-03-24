

import { useState, useEffect, useRef, useCallback } from 'react';
import { ethers } from 'ethers';
import { ContractId } from '@hashgraph/sdk';
import {
  useWallet, useAccountId, useAssociateTokens,
  useWriteContract, useWatchTransactionReceipt,
  useApproveTokenAllowance, useReadContract,
} from '@buidlerlabs/hashgraph-react-wallets';
import { HashpackConnector } from '@buidlerlabs/hashgraph-react-wallets/connectors';

const SYNTH_MINTER_CONTRACT_ID = '0.0.8353935';
const SYNTH_MINTER_EVM_ADDR    = '0x00000000000000000000000000000000007f788f';
const SAUCE_STAKING_CONTRACT_ID = '0.0.8353940'; // update after deploy
const SAUCE_STAKING_EVM_ADDR    = '0x00000000000000000000000000000000007f7894';  // update after deploy
const MIRROR_BASE              = 'https://testnet.mirrornode.hedera.com/api/v1';
const HASHIO_RPC               = 'https://testnet.hashio.io/api';
const CREATE_TOKEN_FEE_HBAR    = 25;
const MINT_FEE_HBAR            = 20;
const SLIPPAGE_BPS             = 9500n;
const ADMIN_ACCOUNT_ID         = '0.0.5020213'; // your admin account

const SYNTH_MINTER_ABI = [
  { inputs: [{ internalType: 'string', name: 'name', type: 'string' },{ internalType: 'string', name: 'symbol', type: 'string' },{ internalType: 'string', name: 'memo', type: 'string' },{ internalType: 'uint8', name: 'decimals', type: 'uint8' },{ internalType: 'int64', name: 'maxSupply', type: 'int64' },{ internalType: 'uint256', name: 'fiatUnitsPerUsd', type: 'uint256' }], name: 'createSynthToken', outputs: [{ internalType: 'address', name: 'tokenAddress', type: 'address' }], stateMutability: 'payable', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'tokenAddress', type: 'address' },{ internalType: 'int64', name: 'synthAmount', type: 'int64' }], name: 'mintSynth', outputs: [], stateMutability: 'payable', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'tokenAddress', type: 'address' },{ internalType: 'int64', name: 'synthAmount', type: 'int64' }], name: 'burnSynth', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'tokenAddress', type: 'address' },{ internalType: 'address', name: 'recipient', type: 'address' },{ internalType: 'uint256', name: 'amountPerSecond', type: 'uint256' },{ internalType: 'uint256', name: 'totalAmount', type: 'uint256' }], name: 'startStreamWithDeposit', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'streamer', type: 'address' },{ internalType: 'address', name: 'tokenAddress', type: 'address' }], name: 'claimStream', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'tokenAddress', type: 'address' }], name: 'cancelStream', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'tokenAddress', type: 'address' },{ internalType: 'uint256', name: 'hbarTinybars', type: 'uint256' }], name: 'previewMint', outputs: [{ internalType: 'int64', name: 'synthAmount', type: 'int64' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'tokenAddress', type: 'address' },{ internalType: 'uint64', name: 'synthAmount', type: 'uint64' }], name: 'previewBurn', outputs: [{ internalType: 'uint256', name: 'hbarTinybars', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'getAllSynthTokens', outputs: [{ internalType: 'address[]', name: '', type: 'address[]' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'tokenAddress', type: 'address' }], name: 'getSynthToken', outputs: [{ components: [{ internalType: 'address', name: 'tokenAddress', type: 'address' },{ internalType: 'string', name: 'name', type: 'string' },{ internalType: 'string', name: 'symbol', type: 'string' },{ internalType: 'uint8', name: 'decimals', type: 'uint8' },{ internalType: 'uint256', name: 'fiatUnitsPerUsd', type: 'uint256' },{ internalType: 'int64', name: 'totalMinted', type: 'int64' },{ internalType: 'bool', name: 'isActive', type: 'bool' },{ internalType: 'address', name: 'creator', type: 'address' }], internalType: 'struct SynthMinter.SynthToken', name: '', type: 'tuple' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'streamer', type: 'address' },{ internalType: 'address', name: 'tokenAddress', type: 'address' }], name: 'getStream', outputs: [{ components: [{ internalType: 'address', name: 'tokenAddress', type: 'address' },{ internalType: 'address', name: 'recipient', type: 'address' },{ internalType: 'uint256', name: 'amountPerSecond', type: 'uint256' },{ internalType: 'uint256', name: 'lastClaimTime', type: 'uint256' },{ internalType: 'uint256', name: 'remainingDeposited', type: 'uint256' }], internalType: 'struct SynthMinter.Stream', name: '', type: 'tuple' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'streamer', type: 'address' },{ internalType: 'address', name: 'tokenAddress', type: 'address' }], name: 'getClaimable', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'getHBARPrice', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
];

const SAUCE_STAKING_ABI = [
  { inputs: [{ internalType: 'uint8', name: 'stakeType', type: 'uint8' },{ internalType: 'uint256', name: 'amount', type: 'uint256' },{ internalType: 'uint8', name: 'tier', type: 'uint8' }], name: 'stake', outputs: [], stateMutability: 'payable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'positionIndex', type: 'uint256' }], name: 'unstake', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'positionIndex', type: 'uint256' }], name: 'claimReward', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'address', name: '_sauceToken', type: 'address' },{ internalType: 'uint8', name: '_decimals', type: 'uint8' }], name: 'setSauceToken', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'amount', type: 'uint256' }], name: 'fundSauceRewards', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'string', name: 'name', type: 'string' },{ internalType: 'string', name: 'description', type: 'string' },{ internalType: 'address', name: 'paymentToken', type: 'address' },{ internalType: 'uint256', name: 'price', type: 'uint256' }], name: 'listProduct', outputs: [{ internalType: 'uint256', name: 'productId', type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'productId', type: 'uint256' },{ internalType: 'address', name: 'newPaymentToken', type: 'address' },{ internalType: 'uint256', name: 'newPrice', type: 'uint256' },{ internalType: 'bool', name: 'active', type: 'bool' }], name: 'updateProduct', outputs: [], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'productId', type: 'uint256' }], name: 'buyProduct', outputs: [{ internalType: 'uint256', name: 'purchaseId', type: 'uint256' }], stateMutability: 'nonpayable', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'user', type: 'address' }], name: 'getPositions', outputs: [{ components: [{ internalType: 'uint256', name: 'positionId', type: 'uint256' },{ internalType: 'uint8', name: 'stakeType', type: 'uint8' },{ internalType: 'uint8', name: 'tier', type: 'uint8' },{ internalType: 'uint256', name: 'amount', type: 'uint256' },{ internalType: 'uint256', name: 'stakedAt', type: 'uint256' },{ internalType: 'uint256', name: 'unlockTime', type: 'uint256' },{ internalType: 'uint256', name: 'lastClaimTime', type: 'uint256' },{ internalType: 'bool', name: 'active', type: 'bool' }], internalType: 'struct SauceStaking.StakePosition[]', name: '', type: 'tuple[]' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'user', type: 'address' },{ internalType: 'uint256', name: 'positionIndex', type: 'uint256' }], name: 'previewReward', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'offset', type: 'uint256' },{ internalType: 'uint256', name: 'limit', type: 'uint256' }], name: 'getActiveProducts', outputs: [{ components: [{ internalType: 'uint256', name: 'productId', type: 'uint256' },{ internalType: 'address', name: 'seller', type: 'address' },{ internalType: 'string', name: 'name', type: 'string' },{ internalType: 'string', name: 'description', type: 'string' },{ internalType: 'address', name: 'paymentToken', type: 'address' },{ internalType: 'uint256', name: 'price', type: 'uint256' },{ internalType: 'bool', name: 'active', type: 'bool' },{ internalType: 'uint256', name: 'createdAt', type: 'uint256' }], internalType: 'struct SauceStaking.Product[]', name: 'result', type: 'tuple[]' },{ internalType: 'uint256', name: 'total', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'buyer', type: 'address' }], name: 'getPurchasesByBuyer', outputs: [{ components: [{ internalType: 'uint256', name: 'purchaseId', type: 'uint256' },{ internalType: 'uint256', name: 'productId', type: 'uint256' },{ internalType: 'address', name: 'buyer', type: 'address' },{ internalType: 'address', name: 'seller', type: 'address' },{ internalType: 'address', name: 'paymentToken', type: 'address' },{ internalType: 'uint256', name: 'pricePaid', type: 'uint256' },{ internalType: 'uint256', name: 'purchasedAt', type: 'uint256' }], internalType: 'struct SauceStaking.Purchase[]', name: '', type: 'tuple[]' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'sauceRewardPool', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'sauceToken', outputs: [{ internalType: 'address', name: '', type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalHbarStaked', outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ internalType: 'address', name: 'user', type: 'address' },{ internalType: 'uint256', name: 'productId', type: 'uint256' }], name: 'hasPurchased', outputs: [{ internalType: 'bool', name: '', type: 'bool' }], stateMutability: 'view', type: 'function' },
];

const S = { IDLE:'idle', APPROVING:'approving', CONFIRMING:'confirming', PENDING:'pending', ASSOCIATING:'associating', DONE:'done', ERROR:'error' };
const SCREEN = { SPLASH:'splash', ONBOARD:'onboard', CONNECT:'connect', APP:'app' };

const TABS = [
  { id:'create',   label:'Create',   icon:'✦',  color:'#00e5a0' },
  { id:'mint',     label:'Mint',     icon:'↑',   color:'#3b9eff' },
  { id:'burn',     label:'Burn',     icon:'↓',   color:'#ff4d6d' },
  { id:'stream',   label:'Stream',   icon:'⟿',  color:'#a78bfa' },
  { id:'claim',    label:'Claim',    icon:'◎',   color:'#ffb340' },
  { id:'rewards',  label:'Rewards',  icon:'★',   color:'#f59e0b' },
  { id:'market',   label:'Market',   icon:'🏪',  color:'#06b6d4' },
  { id:'list',     label:'List',     icon:'📋',  color:'#10b981' },
  { id:'myitems',  label:'My Items', icon:'🎒',  color:'#8b5cf6' },
  { id:'admin',    label:'Admin',    icon:'⚙',   color:'#ef4444' },
];

const MAIN_TABS   = ['create','mint','burn','stream','claim'];
const EXTRA_TABS  = ['rewards','market','list','myitems'];
const ADMIN_TABS  = ['admin'];

const FIAT_PRESETS = [
  { label:'sUSD', fiatUnitsPerUsd:'1000000',  decimals:6 },
  { label:'sEUR', fiatUnitsPerUsd:'910000',   decimals:6 },
  { label:'sINR', fiatUnitsPerUsd:'84000000', decimals:6 },
  { label:'sGBP', fiatUnitsPerUsd:'790000',   decimals:6 },
];

const TX_STEPS = {
  [S.APPROVING]:   { label:'Approving Allowance', desc:'Sign approval in HashPack',  progress:25,  icon:'🔐' },
  [S.CONFIRMING]:  { label:'Confirm Transaction', desc:'Review in HashPack wallet',  progress:50,  icon:'✍️' },
  [S.PENDING]:     { label:'Broadcasting',        desc:'Propagating on Hedera…',     progress:75,  icon:'📡' },
  [S.ASSOCIATING]: { label:'Associating Token',   desc:'Link token to your account', progress:90,  icon:'🔗' },
};

const ONBOARD_SLIDES = [
  { icon:'✦', title:'Synthetic Assets\non Hedera', sub:'Create, mint & burn fiat-pegged tokens backed by HBAR collateral at 150% ratio.', color:'#00e5a0', bg:'radial-gradient(ellipse at 50% 30%, rgba(0,229,160,0.18) 0%, transparent 65%)' },
  { icon:'⟿', title:'Real-time\nPayment Streams', sub:'Stream synth tokens per-second to any address. Cancel anytime, funds returned instantly.', color:'#a78bfa', bg:'radial-gradient(ellipse at 50% 30%, rgba(167,139,250,0.18) 0%, transparent 65%)' },
  { icon:'★',  title:'Earn SAUCE\nRewards', sub:'Stake HBAR when you mint and earn SAUCE token rewards. Unstake anytime (early exit penalty applies).', color:'#f59e0b', bg:'radial-gradient(ellipse at 50% 30%, rgba(245,158,11,0.18) 0%, transparent 65%)' },
  { icon:'ℏ',  title:'Powered by\nHedera Network', sub:'All transactions settle in 3–5 seconds with near-zero fees on Hedera testnet.', color:'#3b9eff', bg:'radial-gradient(ellipse at 50% 30%, rgba(59,158,255,0.18) 0%, transparent 65%)' },
];

// ─── MIRROR NODE HELPERS ──────────────────────────────────────────────────────
async function mirrorGetAccountEvmAddress(hederaAccountId) {
  try {
    const res = await fetch(`${MIRROR_BASE}/accounts/${hederaAccountId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    return json.evm_address ?? null;
  } catch (err) { console.warn(err.message); return null; }
}
async function mirrorGetTokenIdFromEvmAddress(tokenEvmAddress) {
  const addr = tokenEvmAddress.toLowerCase();
  try {
    const res = await fetch(`${MIRROR_BASE}/tokens?token.evm.address=${addr}&limit=1`);
    if (res.ok) { const json = await res.json(); if (json.tokens?.length > 0) return json.tokens[0].token_id; }
  } catch (_) {}
  try {
    const num = parseInt(addr.replace('0x',''), 16);
    const res = await fetch(`${MIRROR_BASE}/tokens/0.0.${num}`);
    if (res.ok) { const json = await res.json(); if (json.token_id) return json.token_id; }
  } catch (_) {}
  return null;
}
async function mirrorGetTokenEvmAddress(hederaTokenId) {
  try {
    const res = await fetch(`${MIRROR_BASE}/tokens/${hederaTokenId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (json.evm_address) return json.evm_address;
    const num = parseInt(hederaTokenId.split('.')[2], 10);
    return '0x' + num.toString(16).padStart(40,'0');
  } catch (err) { console.warn(err.message); return null; }
}
function formatMirrorTxId(txId) { return txId.toString().replace('@','-').replace(/\.(\d+)$/,'-$1'); }
async function pollMirrorForTokenCreation(txId, maxAttempts=14, initialDelay=6000) {
  const url = `${MIRROR_BASE}/transactions/${formatMirrorTxId(txId)}`;
  await new Promise(r => setTimeout(r, initialDelay));
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const tx = (data.transactions??[]).find(t=>t.name==='TOKENCREATION'&&t.entity_id);
        if (tx) { const tid = tx.entity_id; return { tokenHederaId:tid, tokenEvmAddress:await mirrorGetTokenEvmAddress(tid) }; }
      }
    } catch (_) {}
    await new Promise(r => setTimeout(r, Math.min(2000*Math.pow(1.5,i),10000)));
  }
  throw new Error('TOKENCREATION not found after max attempts');
}

// ─── CONTRACT READ HELPERS ────────────────────────────────────────────────────
async function fetchAllSynthTokens() {
  try {
    const provider = new ethers.JsonRpcProvider(HASHIO_RPC);
    const iface    = new ethers.Interface(SYNTH_MINTER_ABI);
    const allData  = await provider.call({ to:SYNTH_MINTER_EVM_ADDR, data:iface.encodeFunctionData('getAllSynthTokens',[]) });
    const [addrs]  = iface.decodeFunctionResult('getAllSynthTokens', allData);
    const tokens   = [];
    for (const addr of addrs) {
      try {
        const stData = await provider.call({ to:SYNTH_MINTER_EVM_ADDR, data:iface.encodeFunctionData('getSynthToken',[addr]) });
        const [st]   = iface.decodeFunctionResult('getSynthToken', stData);
        if (st.isActive) {
          const hederaTokenId = await mirrorGetTokenIdFromEvmAddress(addr);
          tokens.push({ evmAddress:addr, hederaTokenId:hederaTokenId??null, name:st.name, symbol:st.symbol, decimals:Number(st.decimals), fiatUnitsPerUsd:st.fiatUnitsPerUsd.toString(), totalMinted:st.totalMinted.toString() });
        }
      } catch (_) {}
    }
    return tokens;
  } catch (err) { console.warn(err.message); return []; }
}
async function fetchHBARPrice() {
  try {
    const provider = new ethers.JsonRpcProvider(HASHIO_RPC);
    const iface    = new ethers.Interface(SYNTH_MINTER_ABI);
    const raw      = await provider.call({ to:SYNTH_MINTER_EVM_ADDR, data:iface.encodeFunctionData('getHBARPrice',[]) });
    const [price]  = iface.decodeFunctionResult('getHBARPrice', raw);
    return price;
  } catch (_) { return null; }
}
async function fetchPreviewMint(tokenEvmAddress, hbarTinybars) {
  try {
    const provider = new ethers.JsonRpcProvider(HASHIO_RPC);
    const iface    = new ethers.Interface(SYNTH_MINTER_ABI);
    const raw      = await provider.call({ to:SYNTH_MINTER_EVM_ADDR, data:iface.encodeFunctionData('previewMint',[tokenEvmAddress,hbarTinybars]) });
    const [amt]    = iface.decodeFunctionResult('previewMint', raw);
    return BigInt(amt.toString());
  } catch (_) { return null; }
}
async function fetchPreviewBurn(tokenEvmAddress, synthAmount) {
  try {
    const provider = new ethers.JsonRpcProvider(HASHIO_RPC);
    const iface    = new ethers.Interface(SYNTH_MINTER_ABI);
    const raw      = await provider.call({ to:SYNTH_MINTER_EVM_ADDR, data:iface.encodeFunctionData('previewBurn',[tokenEvmAddress,synthAmount]) });
    const [hbar]   = iface.decodeFunctionResult('previewBurn', raw);
    return BigInt(hbar.toString());
  } catch (_) { return null; }
}
async function fetchStream(streamerEvmAddr, tokenEvmAddress) {
  try {
    const provider = new ethers.JsonRpcProvider(HASHIO_RPC);
    const iface    = new ethers.Interface(SYNTH_MINTER_ABI);
    const raw      = await provider.call({ to:SYNTH_MINTER_EVM_ADDR, data:iface.encodeFunctionData('getStream',[streamerEvmAddr,tokenEvmAddress]) });
    const [s]      = iface.decodeFunctionResult('getStream', raw);
    return s;
  } catch (_) { return null; }
}
async function fetchClaimable(streamerEvmAddr, tokenEvmAddress) {
  try {
    const provider = new ethers.JsonRpcProvider(HASHIO_RPC);
    const iface    = new ethers.Interface(SYNTH_MINTER_ABI);
    const raw      = await provider.call({ to:SYNTH_MINTER_EVM_ADDR, data:iface.encodeFunctionData('getClaimable',[streamerEvmAddr,tokenEvmAddress]) });
    const [amt]    = iface.decodeFunctionResult('getClaimable', raw);
    return BigInt(amt.toString());
  } catch (_) { return null; }
}

// ─── PARTICLE CANVAS ──────────────────────────────────────────────────────────
function Particles({ active, color='#00e5a0', count=36 }) {
  const canvasRef = useRef(null);
  const rafRef    = useRef(null);
  const pRef      = useRef([]);
  useEffect(() => {
    if (!active) { pRef.current = []; return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width = canvas.offsetWidth;
    const H = canvas.height = canvas.offsetHeight;
    pRef.current = Array.from({ length: count }, () => ({
      x:W/2+(Math.random()-.5)*80, y:H/2+(Math.random()-.5)*80,
      vx:(Math.random()-.5)*4, vy:-Math.random()*5-1,
      size:Math.random()*5+1, life:1, decay:Math.random()*.012+.005,
    }));
    function draw() {
      ctx.clearRect(0,0,W,H);
      pRef.current = pRef.current.filter(p=>p.life>0);
      pRef.current.forEach(p => {
        ctx.save(); ctx.globalAlpha=p.life*.9; ctx.fillStyle=color; ctx.shadowColor=color; ctx.shadowBlur=10;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.size,0,Math.PI*2); ctx.fill(); ctx.restore();
        p.x+=p.vx; p.y+=p.vy; p.vy+=.06; p.life-=p.decay;
      });
      if (pRef.current.length>0) rafRef.current=requestAnimationFrame(draw);
    }
    draw();
    return () => { cancelAnimationFrame(rafRef.current); if(canvas){ const c=canvas.getContext('2d'); c.clearRect(0,0,canvas.width,canvas.height); }};
  }, [active, color, count]);
  if (!active) return null;
  return <canvas ref={canvasRef} style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none', zIndex:10 }} />;
}

function RingProgress({ progress=0, size=130, color='#00e5a0', children }) {
  const r = (size-10)/2;
  const circ = 2*Math.PI*r;
  const dash = (progress/100)*circ;
  return (
    <div style={{ position:'relative', width:size, height:size }}>
      <svg width={size} height={size} style={{ transform:'rotate(-90deg)', position:'absolute', inset:0 }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={8} />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition:'stroke-dasharray .7s cubic-bezier(.4,0,.2,1)', filter:`drop-shadow(0 0 8px ${color})` }} />
      </svg>
      <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', flexDirection:'column' }}>
        {children}
      </div>
    </div>
  );
}

function PulseDot({ color='#00e5a0', size=8 }) {
  return (
    <span style={{ position:'relative', display:'inline-flex', alignItems:'center', justifyContent:'center', width:size+4, height:size+4 }}>
      <span style={{ position:'absolute', inset:0, borderRadius:'50%', background:color, opacity:.35, animation:'pulse-ring 1.6s ease-out infinite' }} />
      <span style={{ width:size, height:size, borderRadius:'50%', background:color, display:'block', position:'relative', zIndex:1, boxShadow:`0 0 6px ${color}` }} />
    </span>
  );
}

function HexGrid({ color='#00e5a0', opacity=0.06 }) {
  return (
    <svg style={{ position:'absolute', inset:0, width:'100%', height:'100%', pointerEvents:'none' }}>
      <defs>
        <pattern id={`hex-${color.replace('#','')}`} x="0" y="0" width="56" height="48" patternUnits="userSpaceOnUse">
          <polygon points="14,2 42,2 56,24 42,46 14,46 0,24" fill="none" stroke={color} strokeOpacity={opacity} strokeWidth="0.8" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#hex-${color.replace('#','')})`} />
    </svg>
  );
}

function FloatingOrbs({ color }) {
  return (
    <>
      <div style={{ position:'absolute', top:'8%', left:'10%', width:200, height:200, borderRadius:'50%', background:`radial-gradient(circle, ${color}22 0%, transparent 70%)`, animation:'float1 6s ease-in-out infinite', pointerEvents:'none' }} />
      <div style={{ position:'absolute', top:'25%', right:'5%', width:140, height:140, borderRadius:'50%', background:`radial-gradient(circle, ${color}18 0%, transparent 70%)`, animation:'float2 8s ease-in-out infinite', pointerEvents:'none' }} />
      <div style={{ position:'absolute', bottom:'20%', left:'15%', width:100, height:100, borderRadius:'50%', background:`radial-gradient(circle, ${color}14 0%, transparent 70%)`, animation:'float3 7s ease-in-out infinite', pointerEvents:'none' }} />
    </>
  );
}

function SideDecoration({ side='left', activeTab='create' }) {
  const tabColor = TABS.find(t=>t.id===activeTab)?.color || '#00e5a0';
  const nodes = [
    { top:'10%', label:'CREATE', val:'✦', c:'#00e5a0' },
    { top:'22%', label:'MINT',   val:'↑', c:'#3b9eff' },
    { top:'34%', label:'BURN',   val:'↓', c:'#ff4d6d' },
    { top:'46%', label:'STREAM', val:'⟿',c:'#a78bfa' },
    { top:'58%', label:'CLAIM',  val:'◎', c:'#ffb340' },
    { top:'70%', label:'REWARDS',val:'★', c:'#f59e0b' },
    { top:'82%', label:'MARKET', val:'🏪',c:'#06b6d4' },
  ];
  const isLeft = side==='left';
  return (
    <div style={{
      position:'fixed', top:0, bottom:0, [isLeft?'left':'right']:0,
      width:'calc((100vw - 430px)/2)',
      display:'flex', flexDirection:'column', alignItems:isLeft?'flex-end':'flex-start',
      justifyContent:'center', pointerEvents:'none', zIndex:5,
      overflow:'hidden',
    }}>
      <div style={{ position:'absolute', top:0, bottom:0, [isLeft?'right':'left']:40, width:1, background:`linear-gradient(to bottom, transparent 0%, ${tabColor}40 30%, ${tabColor}60 50%, ${tabColor}40 70%, transparent 100%)`, animation:'line-pulse 3s ease-in-out infinite' }} />
      <div style={{ position:'absolute', [isLeft?'right':'left']:36, width:9, height:9, borderRadius:'50%', background:tabColor, boxShadow:`0 0 12px ${tabColor}, 0 0 24px ${tabColor}80`, animation:'line-dot-move 4s ease-in-out infinite', zIndex:2 }} />
      {nodes.map((n,i)=>(
        <div key={i} style={{ position:'absolute', top:n.top, [isLeft?'right':'left']:44, display:'flex', alignItems:'center', gap:10, flexDirection:isLeft?'row-reverse':'row', animation:`fade-in .6s ${i*.1}s ease both` }}>
          <div style={{ display:'flex', flexDirection:'column', alignItems:isLeft?'flex-end':'flex-start' }}>
            <div style={{ fontSize:14, color:n.c, opacity: activeTab===n.label.toLowerCase()?1:0.35, filter: activeTab===n.label.toLowerCase()?`drop-shadow(0 0 6px ${n.c})`:'none', transition:'all .4s' }}>{n.val}</div>
            <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:7, color:n.c, opacity: activeTab===n.label.toLowerCase()?0.8:0.2, letterSpacing:1.5, transition:'all .4s' }}>{n.label}</div>
          </div>
        </div>
      ))}
      <div style={{ position:'absolute', bottom:60, [isLeft?'right':'left']:20, fontFamily:"'JetBrains Mono',monospace", fontSize:8, color:tabColor, opacity:0.3, letterSpacing:2, writingMode:'vertical-rl', textOrientation:'mixed', animation:'fade-in 1s ease both' }}>
        {isLeft ? 'HEDERA · TESTNET' : 'SYNTH · PROTOCOL'}
      </div>
    </div>
  );
}

function TickerTape({ hbarPrice }) {
  const items = ['HBAR/USD', hbarPrice?`$${(Number(hbarPrice)/1e8).toFixed(4)}`:'—', '✦', 'TESTNET', '✦', '150%', 'COLLAT', '✦', '3-5s', 'FINALITY', '✦', 'HTS', 'FUNGIBLE', '✦', 'SYNTH', 'PROTOCOL', '✦', 'SAUCE', 'REWARDS', '✦'];
  const text = items.join('  ');
  return (
    <div style={{ position:'fixed', bottom:0, left:0, right:0, height:22, overflow:'hidden', zIndex:3, background:'rgba(0,0,0,0.3)', borderTop:'1px solid rgba(255,255,255,0.04)', pointerEvents:'none' }}>
      <div style={{ display:'flex', gap:0, animation:'ticker 20s linear infinite', whiteSpace:'nowrap', paddingTop:3 }}>
        {[...Array(3)].map((_,i)=>(
          <span key={i} style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8, color:'rgba(0,229,160,0.35)', letterSpacing:2, paddingRight:60 }}>{text}</span>
        ))}
      </div>
    </div>
  );
}

function GlobalStyles() {
  useEffect(() => {
    // Inject preconnect + font link into <head> once
    if (document.getElementById('synth-fonts')) return;

    const preconnect1 = document.createElement('link');
    preconnect1.rel = 'preconnect';
    preconnect1.href = 'https://fonts.googleapis.com';

    const preconnect2 = document.createElement('link');
    preconnect2.rel = 'preconnect';
    preconnect2.href = 'https://fonts.gstatic.com';
    preconnect2.crossOrigin = 'anonymous';

    const link = document.createElement('link');
    link.id = 'synth-fonts';
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@300;400;500;700&display=swap';

    document.head.appendChild(preconnect1);
    document.head.appendChild(preconnect2);
    document.head.appendChild(link);
  }, []);

  return (
    <style>{`
      *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
      html, body {
        height:100%; overflow:hidden; background:#080b10;
        -webkit-tap-highlight-color:transparent;
        font-family: 'Space Grotesk', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      /* Prevent FOUT by declaring fallback stacks */
      body, button, input {
        font-family: 'Space Grotesk', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      }
      input[type=number]::-webkit-outer-spin-button,
      input[type=number]::-webkit-inner-spin-button { -webkit-appearance:none; margin:0; }
      input[type=number] { -moz-appearance:textfield; }
      ::-webkit-scrollbar { display:none; }
      @keyframes fade-in        { from{opacity:0} to{opacity:1} }
      @keyframes fade-scale     { from{opacity:0;transform:scale(.94)} to{opacity:1;transform:scale(1)} }
      @keyframes spin           { to{transform:rotate(360deg)} }
      @keyframes slow-rotate    { to{transform:rotate(360deg) translateY(-50%)} }
      @keyframes splash-logo    { 0%{opacity:0;transform:scale(.7)} 60%{opacity:1;transform:scale(1.04)} 100%{opacity:1;transform:scale(1)} }
      @keyframes splash-exit    { to{opacity:0;transform:scale(1.1)} }
      @keyframes scan-down      { 0%{top:-2px;opacity:0} 5%{opacity:1} 95%{opacity:1} 100%{top:100%;opacity:0} }
      @keyframes load-bar       { 0%{width:0} 100%{width:100%} }
      @keyframes pulse-ring     { 0%{transform:scale(.8);opacity:.8} 70%{transform:scale(2.2);opacity:0} 100%{transform:scale(2.2);opacity:0} }
      @keyframes glow-breathe   { 0%,100%{opacity:.6;transform:scale(1)} 50%{opacity:1;transform:scale(1.08)} }
      @keyframes float1         { 0%,100%{transform:translate(0,0)} 50%{transform:translate(8px,-14px)} }
      @keyframes float2         { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-10px,10px)} }
      @keyframes float3         { 0%,100%{transform:translate(0,0)} 50%{transform:translate(6px,-8px)} }
      @keyframes orbit-1        { from{transform:rotate(0deg) translateX(80px) rotate(0deg)} to{transform:rotate(360deg) translateX(80px) rotate(-360deg)} }
      @keyframes orbit-2        { from{transform:rotate(120deg) translateX(80px) rotate(-120deg)} to{transform:rotate(480deg) translateX(80px) rotate(-480deg)} }
      @keyframes orbit-3        { from{transform:rotate(240deg) translateX(80px) rotate(-240deg)} to{transform:rotate(600deg) translateX(80px) rotate(-600deg)} }
      @keyframes ring-draw      { to{stroke-dashoffset:0} }
      @keyframes check-draw     { to{stroke-dashoffset:0} }
      @keyframes ring-out       { 0%{transform:scale(1);opacity:.8} 100%{transform:scale(1.5);opacity:0} }
      @keyframes ripple         { to{transform:scale(4);opacity:0} }
      @keyframes conv-pulse     { 0%,100%{opacity:.3;transform:scale(.8)} 50%{opacity:1;transform:scale(1)} }
      @keyframes success-pulse  { 0%,100%{box-shadow:0 0 30px rgba(0,229,160,0.1)} 50%{box-shadow:0 0 70px rgba(0,229,160,0.5)} }
      @keyframes line-pulse     { 0%,100%{opacity:.4} 50%{opacity:1} }
      @keyframes line-dot-move  { 0%{top:10%;opacity:0} 10%{opacity:1} 90%{opacity:1} 100%{top:90%;opacity:0} }
      @keyframes data-stream-h  { 0%{opacity:0;transform:scaleX(0)} 50%{opacity:1;transform:scaleX(1)} 100%{opacity:0;transform:scaleX(0)} }
      @keyframes ticker         { from{transform:translateX(0)} to{transform:translateX(-33.33%)} }
      @keyframes spin-slow      { to{transform:rotate(360deg)} }
      @keyframes slide-in-right { from{opacity:0;transform:translateX(40px)} to{opacity:1;transform:translateX(0)} }
      @keyframes slide-in-left  { from{opacity:0;transform:translateX(-40px)} to{opacity:1;transform:translateX(0)} }
      @keyframes reward-glow    { 0%,100%{box-shadow:0 0 20px rgba(245,158,11,0.2)} 50%{box-shadow:0 0 40px rgba(245,158,11,0.5)} }
    `}</style>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SPLASH
// ═══════════════════════════════════════════════════════════════════════════════
function SplashScreen({ done }) {
  return (
    <>
      <GlobalStyles />
      <div style={{ position:'fixed', inset:0, background:'#080b10', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', overflow:'hidden' }}>
        <HexGrid color="#00e5a0" opacity={0.05} />
        <FloatingOrbs color="#00e5a0" />
        <div style={{ position:'absolute', top:0, left:0, right:0, height:'100%', overflow:'hidden', pointerEvents:'none', zIndex:2 }}>
          <div style={{ position:'absolute', left:0, right:0, height:2, background:'linear-gradient(90deg,transparent,rgba(0,229,160,0.6),transparent)', boxShadow:'0 0 12px rgba(0,229,160,0.5)', animation:'scan-down 2.2s ease-in-out forwards' }} />
        </div>
        <div style={{ position:'relative', zIndex:3, display:'flex', flexDirection:'column', alignItems:'center', animation:done?'splash-exit .6s .1s ease forwards':'splash-logo 1s ease both' }}>
          <div style={{ width:96, height:96, borderRadius:28, marginBottom:24, background:'linear-gradient(135deg, rgba(0,229,160,0.15), rgba(0,229,160,0.04))', border:'1px solid rgba(0,229,160,0.3)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:40, position:'relative', boxShadow:'0 0 60px rgba(0,229,160,0.15), inset 0 1px 0 rgba(255,255,255,0.08)' }}>
            ✦
            <div style={{ position:'absolute', inset:-2, borderRadius:30, border:'1px solid rgba(0,229,160,0.1)', animation:'spin-slow 8s linear infinite' }} />
            <div style={{ position:'absolute', inset:-8, borderRadius:36, border:'1px dashed rgba(0,229,160,0.07)', animation:'spin-slow 12s linear infinite reverse' }} />
          </div>
          <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:36, fontWeight:800, letterSpacing:-1.5, color:'#fff', lineHeight:1 }}>
            Synth<span style={{ color:'#00e5a0' }}>Protocol</span>
          </div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'rgba(0,229,160,0.6)', letterSpacing:4, marginTop:8, textTransform:'uppercase' }}>Hedera Testnet</div>
        </div>
        <div style={{ position:'absolute', bottom:60, left:40, right:40, zIndex:3 }}>
          <div style={{ height:2, background:'rgba(255,255,255,0.06)', borderRadius:1, overflow:'hidden' }}>
            <div style={{ height:'100%', background:'linear-gradient(90deg,#00e5a0,#3b9eff)', borderRadius:1, animation:'load-bar 2s ease forwards', boxShadow:'0 0 8px #00e5a0' }} />
          </div>
          <div style={{ textAlign:'center', marginTop:10, fontFamily:"'JetBrains Mono',monospace", fontSize:9, color:'rgba(255,255,255,0.2)', letterSpacing:2 }}>INITIALIZING PROTOCOL</div>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ONBOARD
// ═══════════════════════════════════════════════════════════════════════════════
function OnboardScreen({ onDone }) {
  const [index,   setIndex]   = useState(0);
  const [visible, setVisible] = useState(true);
  const slide = ONBOARD_SLIDES[index];
  const isLast = index === ONBOARD_SLIDES.length - 1;
  function animateTransition(newIndex) { setVisible(false); setTimeout(() => { setIndex(newIndex); setVisible(true); }, 200); }
  function goNext() { if (index < ONBOARD_SLIDES.length - 1) { animateTransition(index + 1); } else { onDone(); } }
  function goPrev() { if (index > 0) animateTransition(index - 1); }
  return (
    <>
      <GlobalStyles />
      <div style={{ position:'fixed', inset:0, background:'#080b10', display:'flex', flexDirection:'column', overflow:'hidden', animation:'fade-in .4s ease' }}>
        <div style={{ position:'absolute', inset:0, background:slide.bg, transition:'background 0.5s ease', pointerEvents:'none', zIndex:0 }} />
        <HexGrid color={slide.color} opacity={0.04} />
        <div style={{ position:'relative', zIndex:2, display:'flex', justifyContent:'flex-end', padding:'52px 24px 0' }}>
          <button onClick={onDone} style={{ background:'rgba(255,255,255,0.06)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:50, padding:'6px 16px', color:'rgba(255,255,255,0.4)', fontSize:12, cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif" }}>Skip</button>
        </div>
        <div style={{ flex:1, display:'flex', alignItems:'center', justifyContent:'center', position:'relative', zIndex:2 }}>
          <div style={{ width:220, height:220, position:'relative', opacity:visible?1:0, transform:visible?'scale(1) translateY(0)':'scale(0.88) translateY(16px)', transition:'all .4s cubic-bezier(.34,1.56,.64,1)' }}>
            <div style={{ position:'absolute', inset:0, borderRadius:'50%', border:`1px solid ${slide.color}20`, animation:'spin-slow 10s linear infinite' }} />
            <div style={{ position:'absolute', inset:16, borderRadius:'50%', border:`1px dashed ${slide.color}15`, animation:'spin-slow 14s linear infinite reverse' }} />
            <div style={{ position:'absolute', inset:32, borderRadius:'50%', background:`radial-gradient(circle, ${slide.color}25 0%, transparent 70%)`, animation:'glow-breathe 3s ease-in-out infinite' }} />
            <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:72, filter:`drop-shadow(0 0 20px ${slide.color})` }}>{slide.icon}</div>
            {[0,1,2].map(i=>(<div key={i} style={{ position:'absolute', top:'50%', left:'50%', width:0, height:0 }}><div style={{ width:8, height:8, borderRadius:'50%', background:slide.color, position:'absolute', marginTop:-4, marginLeft:-4, boxShadow:`0 0 8px ${slide.color}`, animation:`orbit-${i+1} ${4+i}s linear infinite` }} /></div>))}
          </div>
        </div>
        <div style={{ position:'relative', zIndex:2, padding:'0 36px 50px' }}>
          <div style={{ display:'flex', justifyContent:'center', gap:8, marginBottom:28 }}>
            {ONBOARD_SLIDES.map((_,i)=>(<div key={i} style={{ height:4, borderRadius:2, transition:'all .3s ease', width:i===index?24:6, background:i===index?slide.color:'rgba(255,255,255,0.2)' }} />))}
          </div>
          <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:32, fontWeight:800, letterSpacing:-1, lineHeight:1.15, color:'#fff', marginBottom:16, whiteSpace:'pre-line', opacity:visible?1:0, transform:visible?'translateY(0)':'translateY(12px)', transition:'all .4s .05s ease' }}>{slide.title}</div>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:13, color:'rgba(255,255,255,0.45)', lineHeight:1.7, marginBottom:36, opacity:visible?1:0, transform:visible?'translateY(0)':'translateY(8px)', transition:'all .4s .1s ease' }}>{slide.sub}</div>
          <div style={{ display:'flex', gap:12, opacity:visible?1:0, transition:'opacity .4s .15s ease' }}>
            {index > 0 && (<button onClick={goPrev} style={{ flex:1, padding:'16px', background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:18, color:'rgba(255,255,255,0.6)', fontSize:15, fontWeight:600, cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif" }}>←</button>)}
            <button onClick={goNext} style={{ flex:3, padding:'17px', background:`linear-gradient(135deg, ${slide.color}, ${slide.color}cc)`, border:'none', borderRadius:18, color:'#020e08', fontSize:15, fontWeight:700, cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif", boxShadow:`0 4px 24px ${slide.color}30`, transition:'all .2s' }}>{isLast ? 'Get Started →' : 'Next →'}</button>
          </div>
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONNECT
// ═══════════════════════════════════════════════════════════════════════════════
function ConnectScreen({ onConnected }) {
  const { isConnected, connect } = useWallet(HashpackConnector);
  const { data: accountId }      = useAccountId();
  const [connecting, setConnecting] = useState(false);
  const [pulse,      setPulse]      = useState(false);
  useEffect(() => { if (isConnected && accountId) { setPulse(true); const t=setTimeout(onConnected,1200); return ()=>clearTimeout(t); }}, [isConnected, accountId]);
  async function handleConnect() { setConnecting(true); try { await connect(); } catch (_) {} setConnecting(false); }
  return (
    <>
      <GlobalStyles />
      <div style={{ position:'fixed', inset:0, background:'#080b10', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', overflow:'hidden', padding:'40px 32px', animation:'fade-in .4s ease' }}>
        <HexGrid color="#00e5a0" opacity={0.05} />
        <FloatingOrbs color="#00e5a0" />
        <div style={{ position:'relative', zIndex:2, width:'100%', maxWidth:380, display:'flex', flexDirection:'column', alignItems:'center' }}>
          <div style={{ position:'relative', marginBottom:32 }}>
            <div style={{ width:88, height:88, borderRadius:26, background:'linear-gradient(135deg, rgba(0,229,160,0.12), rgba(59,158,255,0.06))', border:'1px solid rgba(0,229,160,0.25)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:40, boxShadow:pulse?'0 0 60px rgba(0,229,160,0.4)':'0 0 30px rgba(0,229,160,0.1)', transition:'box-shadow .5s ease', animation:pulse?'success-pulse 1.2s ease':'none' }}>ℏ</div>
            {pulse && (<><div style={{ position:'absolute', inset:-12, borderRadius:36, border:'2px solid rgba(0,229,160,0.3)', animation:'ring-out .6s ease forwards' }} /><div style={{ position:'absolute', inset:-24, borderRadius:46, border:'2px solid rgba(0,229,160,0.15)', animation:'ring-out .6s .15s ease forwards' }} /></>)}
          </div>
          {pulse ? (
            <div style={{ textAlign:'center', animation:'fade-in .4s ease' }}>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:26, fontWeight:800, color:'#00e5a0', marginBottom:8 }}>Connected!</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'rgba(255,255,255,0.4)' }}>{accountId?.toString()}</div>
            </div>
          ) : (
            <>
              <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:28, fontWeight:800, color:'#fff', textAlign:'center', letterSpacing:-0.5, marginBottom:10 }}>Connect Wallet</div>
              <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:'rgba(255,255,255,0.35)', textAlign:'center', lineHeight:1.7, marginBottom:40 }}>Connect HashPack to access Synth Protocol on Hedera Testnet</div>
              <button onClick={handleConnect} disabled={connecting} style={{ width:'100%', padding:'20px', marginBottom:16, background:connecting?'rgba(255,255,255,0.04)':'linear-gradient(135deg, rgba(0,229,160,0.12), rgba(0,229,160,0.04))', border:'1px solid rgba(0,229,160,0.3)', borderRadius:20, display:'flex', alignItems:'center', gap:16, cursor:'pointer', transition:'all .2s', position:'relative', overflow:'hidden' }}>
                <div style={{ width:46, height:46, borderRadius:14, background:'rgba(0,229,160,0.1)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, flexShrink:0 }}>ℏ</div>
                <div style={{ flex:1, textAlign:'left' }}>
                  <div style={{ fontFamily:"'Space Grotesk',sans-serif", fontSize:16, fontWeight:700, color:connecting?'rgba(255,255,255,0.4)':'#fff' }}>HashPack Wallet</div>
                  <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'rgba(255,255,255,0.3)', marginTop:2 }}>Hedera Native · Recommended</div>
                </div>
                {connecting ? <div style={{ width:20, height:20, borderRadius:'50%', border:'2px solid rgba(0,229,160,0.3)', borderTopColor:'#00e5a0', animation:'spin 1s linear infinite' }} /> : <div style={{ fontSize:16, color:'rgba(0,229,160,0.5)' }}>→</div>}
              </button>
              <div style={{ display:'flex', alignItems:'center', gap:8, padding:'12px 16px', background:'rgba(255,255,255,0.025)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:12, width:'100%' }}>
                <span style={{ fontSize:14 }}>🔒</span>
                <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:10, color:'rgba(255,255,255,0.3)', lineHeight:1.5 }}>No private keys exposed · All transactions signed in HashPack</span>
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN EXPORT
// ═══════════════════════════════════════════════════════════════════════════════
export default function SynthMinterApp() {
  const [screen,     setScreen]     = useState(SCREEN.SPLASH);
  const [splashDone, setSplashDone] = useState(false);
  useEffect(() => { const t=setTimeout(()=>setSplashDone(true),2200); return ()=>clearTimeout(t); }, []);
  useEffect(() => { if (splashDone) { const t=setTimeout(()=>setScreen(SCREEN.ONBOARD),600); return ()=>clearTimeout(t); }}, [splashDone]);
  if (screen===SCREEN.SPLASH)   return <SplashScreen done={splashDone} />;
  if (screen===SCREEN.ONBOARD)  return <OnboardScreen onDone={()=>setScreen(SCREEN.CONNECT)} />;
  if (screen===SCREEN.CONNECT)  return <ConnectScreen onConnected={()=>setScreen(SCREEN.APP)} />;
  return <AppScreen />;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  APP SCREEN
// ═══════════════════════════════════════════════════════════════════════════════
function AppScreen() {
  const { isConnected, disconnect }        = useWallet(HashpackConnector);
  const { data: accountId }                = useAccountId();
  const { associateTokens }                = useAssociateTokens();
  const { writeContract }                  = useWriteContract({ connector:HashpackConnector });
  const { watch }                          = useWatchTransactionReceipt({ abi:SYNTH_MINTER_ABI });
  const { approve: approveTokenAllowance } = useApproveTokenAllowance({ connector:HashpackConnector });
  const { readContract }                   = useReadContract();

  const isAdmin = accountId?.toString() === ADMIN_ACCOUNT_ID;

  const [hederaEvmAddress, setHederaEvmAddress] = useState(null);
  const [activeTab,   setActiveTab]   = useState('create');
  const [step,        setStep]        = useState(S.IDLE);
  const [errMsg,      setErrMsg]      = useState(null);
  const [doneMsg,     setDoneMsg]     = useState('');
  const [showParticles, setShowParticles] = useState(false);
  const [showProfile,   setShowProfile]   = useState(false);

  const [synthTokens,   setSynthTokens]   = useState([]);
  const [tokensLoading, setTokensLoading] = useState(false);
  const [selectedToken, setSelectedToken] = useState(null);
  const [hbarPrice,     setHbarPrice]     = useState(null);

  // Create
  const [createName,     setCreateName]     = useState('');
  const [createSymbol,   setCreateSymbol]   = useState('');
  const [createMemo,     setCreateMemo]     = useState('');
  const [createDecimals, setCreateDecimals] = useState('6');
  const [createMaxSup,   setCreateMaxSup]   = useState('0');
  const [createFiat,     setCreateFiat]     = useState('1000000');

  // Mint
  const [mintHbar,    setMintHbar]    = useState(String(MINT_FEE_HBAR));
  const [mintPreview, setMintPreview] = useState(null);
  const [mintLoading, setMintLoading] = useState(false);
  const [mintTier,    setMintTier]    = useState(1); // 0=FLEX,1=T30,2=T90,3=T180

  // Burn
  const [burnAmount,  setBurnAmount]  = useState('');
  const [burnPreview, setBurnPreview] = useState(null);
  const [burnLoading, setBurnLoading] = useState(false);

  // Stream
  const [streamRecipient, setStreamRecipient] = useState('');
  const [streamRate,      setStreamRate]      = useState('100');
  const [streamDeposit,   setStreamDeposit]   = useState('5000');
  const [activeStream,    setActiveStream]    = useState(null);

  // Claim stream
  const [claimStreamer, setClaimStreamer] = useState('');
  const [claimable,     setClaimable]    = useState(null);
  const [claimLoading,  setClaimLoading] = useState(false);

  // Rewards (staking)
  const [stakePositions,  setStakePositions]  = useState([]);
  const [rewardsLoading,  setRewardsLoading]  = useState(false);
  const [positionRewards, setPositionRewards] = useState({});

  // Market
  const [marketProducts,  setMarketProducts]  = useState([]);
  const [marketLoading,   setMarketLoading]   = useState(false);
  const [myPurchases,     setMyPurchases]     = useState([]);
  const [myPurchasesLoading, setMyPurchasesLoading] = useState(false);

  // List product
  const [listName,        setListName]        = useState('');
  const [listDesc,        setListDesc]        = useState('');
  const [listPayToken,    setListPayToken]    = useState('');
  const [listPrice,       setListPrice]       = useState('');

  // Admin
  const [adminSauceAddr,  setAdminSauceAddr]  = useState('');
  const [adminSauceDec,   setAdminSauceDec]   = useState('8');
  const [adminFundAmt,    setAdminFundAmt]    = useState('');
  const [adminSauceTokenId, setAdminSauceTokenId] = useState('');
  const [adminPoolBalance,  setAdminPoolBalance]  = useState(null);

  useEffect(() => {
    if (!accountId) { setHederaEvmAddress(null); return; }
    mirrorGetAccountEvmAddress(accountId.toString()).then(addr=>{ if(addr) setHederaEvmAddress(addr); });
  }, [accountId]);

  useEffect(() => { loadTokens(); loadHbarPrice(); }, []);

  async function loadTokens() {
    setTokensLoading(true);
    const tokens = await fetchAllSynthTokens();
    setSynthTokens(tokens);
    if (tokens.length>0 && !selectedToken) setSelectedToken(tokens[0]);
    setTokensLoading(false);
  }
  async function loadHbarPrice() { const p=await fetchHBARPrice(); setHbarPrice(p); }

  // ── Load staking positions via useReadContract ──
  async function loadRewards() {
    if (!hederaEvmAddress) return;
    setRewardsLoading(true);
    try {
      const positions = await readContract({
        address: SAUCE_STAKING_EVM_ADDR,
        abi: SAUCE_STAKING_ABI,
        functionName: 'getPositions',
        args: [hederaEvmAddress],
      });
      const active = (positions||[]).filter(p=>p.active);
      setStakePositions(active);
      // fetch preview for each
      const rewards = {};
      for (let i = 0; i < active.length; i++) {
        try {
          const reward = await readContract({
            address: SAUCE_STAKING_EVM_ADDR,
            abi: SAUCE_STAKING_ABI,
            functionName: 'previewReward',
            args: [hederaEvmAddress, BigInt(i)],
          });
          rewards[i] = reward;
        } catch (_) { rewards[i] = 0n; }
      }
      setPositionRewards(rewards);
    } catch (e) { console.warn(e); }
    setRewardsLoading(false);
  }

  // ── Load market products via useReadContract ──
  async function loadMarket() {
    setMarketLoading(true);
    try {
      const result = await readContract({
        address: SAUCE_STAKING_EVM_ADDR,
        abi: SAUCE_STAKING_ABI,
        functionName: 'getActiveProducts',
        args: [0n, 50n],
      });
      setMarketProducts(result?.[0] ?? []);
    } catch (e) { console.warn(e); }
    setMarketLoading(false);
  }

  // ── Load my purchases via useReadContract ──
  async function loadMyPurchases() {
    if (!hederaEvmAddress) return;
    setMyPurchasesLoading(true);
    try {
      const result = await readContract({
        address: SAUCE_STAKING_EVM_ADDR,
        abi: SAUCE_STAKING_ABI,
        functionName: 'getPurchasesByBuyer',
        args: [hederaEvmAddress],
      });
      setMyPurchases(result ?? []);
    } catch (e) { console.warn(e); }
    setMyPurchasesLoading(false);
  }

  // ── Load admin pool info via useReadContract ──
  async function loadAdminInfo() {
    try {
      const pool = await readContract({
        address: SAUCE_STAKING_EVM_ADDR,
        abi: SAUCE_STAKING_ABI,
        functionName: 'sauceRewardPool',
        args: [],
      });
      setAdminPoolBalance(pool);
      const sauce = await readContract({
        address: SAUCE_STAKING_EVM_ADDR,
        abi: SAUCE_STAKING_ABI,
        functionName: 'sauceToken',
        args: [],
      });
      if (sauce && sauce !== '0x0000000000000000000000000000000000000000') {
        setAdminSauceAddr(sauce);
      }
    } catch (e) { console.warn(e); }
  }

  useEffect(() => {
    if (!selectedToken||!mintHbar||isNaN(parseFloat(mintHbar))) { setMintPreview(null); return; }
    const t=setTimeout(async()=>{ setMintLoading(true); const preview=await fetchPreviewMint(selectedToken.evmAddress,BigInt(Math.floor(parseFloat(mintHbar)*1e8))); setMintPreview(preview); setMintLoading(false); },600);
    return ()=>clearTimeout(t);
  }, [selectedToken, mintHbar]);

  useEffect(() => {
    if (!selectedToken||!burnAmount||isNaN(parseFloat(burnAmount))) { setBurnPreview(null); return; }
    const t=setTimeout(async()=>{ setBurnLoading(true); const preview=await fetchPreviewBurn(selectedToken.evmAddress,BigInt(Math.floor(parseFloat(burnAmount)*Math.pow(10,selectedToken.decimals)))); setBurnPreview(preview); setBurnLoading(false); },600);
    return ()=>clearTimeout(t);
  }, [selectedToken, burnAmount]);

  useEffect(() => {
    if (activeTab==='stream'&&selectedToken&&hederaEvmAddress) loadStreamInfo();
  }, [activeTab, selectedToken, hederaEvmAddress]);

  useEffect(() => {
    if (activeTab==='rewards' && hederaEvmAddress) loadRewards();
  }, [activeTab, hederaEvmAddress]);

  useEffect(() => {
    if (activeTab==='market') loadMarket();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab==='myitems' && hederaEvmAddress) loadMyPurchases();
  }, [activeTab, hederaEvmAddress]);

  useEffect(() => {
    if (activeTab==='admin' && isAdmin) loadAdminInfo();
  }, [activeTab, isAdmin]);

  useEffect(() => {
    if (activeTab!=='claim'||!selectedToken||!claimStreamer) { setClaimable(null); return; }
    const t=setTimeout(async()=>{ setClaimLoading(true); const amt=await fetchClaimable(claimStreamer,selectedToken.evmAddress); setClaimable(amt); setClaimLoading(false); },600);
    return ()=>clearTimeout(t);
  }, [activeTab, claimStreamer, selectedToken]);

  async function loadStreamInfo() {
    if (!hederaEvmAddress||!selectedToken) return;
    const s=await fetchStream(hederaEvmAddress,selectedToken.evmAddress);
    setActiveStream(s&&s.recipient!=='0x0000000000000000000000000000000000000000'?s:null);
  }

  function resetFlow() { setStep(S.IDLE); setErrMsg(null); setDoneMsg(''); setShowParticles(false); }
  function watchTx(txIdOrHash) {
    return new Promise((resolve,reject)=>{
      watch(txIdOrHash,{ onSuccess:tx=>resolve(tx.transaction_id??txIdOrHash), onError:(_,err)=>reject(new Error(err?.message??'Transaction failed')) });
    });
  }

  // ── HANDLE CREATE (unchanged) ──
  async function handleCreate() {
    if (!isConnected||!accountId||!createName||!createSymbol) return;
    resetFlow();
    try {
      setStep(S.CONFIRMING);
      const txIdOrHash=await writeContract({ contractId:ContractId.fromString(SYNTH_MINTER_CONTRACT_ID), abi:SYNTH_MINTER_ABI, functionName:'createSynthToken', args:[createName,createSymbol,createMemo||`Synthetic ${createSymbol}`,parseInt(createDecimals),parseInt(createMaxSup),BigInt(createFiat)], metaArgs:{ gas:1_500_000, amount:CREATE_TOKEN_FEE_HBAR } });
      setStep(S.PENDING);
      const resolvedTxId=await watchTx(txIdOrHash);
      const { tokenHederaId, tokenEvmAddress }=await pollMirrorForTokenCreation(resolvedTxId);
      setStep(S.ASSOCIATING);
      await associateTokens([tokenHederaId]);
      await loadTokens();
      setDoneMsg(`${createSymbol} created!\n${tokenHederaId}`);
      setStep(S.DONE); setShowParticles(true); setTimeout(()=>setShowParticles(false),3000);
    } catch(err) { setErrMsg(err.message??'Unknown error'); setStep(S.ERROR); }
  }

  // ── HANDLE MINT + AUTO STAKE ──
  async function handleMint() {
    if (!isConnected||!accountId||!selectedToken||!mintPreview||mintPreview<=0n) return;
    resetFlow();
    try {
      const minAccept=(mintPreview*SLIPPAGE_BPS)/10000n;
      setStep(S.CONFIRMING);
      // 1. Mint synth
      const txIdOrHash=await writeContract({ contractId:ContractId.fromString(SYNTH_MINTER_CONTRACT_ID), abi:SYNTH_MINTER_ABI, functionName:'mintSynth', args:[selectedToken.evmAddress,minAccept], metaArgs:{ gas:800_000, amount:parseFloat(mintHbar) } });
      setStep(S.PENDING);
      await watchTx(txIdOrHash);
      // 2. Auto-stake with same HBAR amount into selected tier
      try {
        const stakeHbar = parseFloat(mintHbar);
        const stakeTxHash = await writeContract({
          contractId: ContractId.fromString(SAUCE_STAKING_CONTRACT_ID),
          abi: SAUCE_STAKING_ABI,
          functionName: 'stake',
          args: [0, 0n, mintTier], // StakeType.HBAR=0, amount=0 (unused for HBAR), tier
          metaArgs: { gas: 400_000, amount: stakeHbar },
        });
        await watchTx(stakeTxHash);
        setDoneMsg(`Minted ${(Number(mintPreview)/Math.pow(10,selectedToken.decimals)).toFixed(4)} ${selectedToken.symbol}\n+ Staked ${stakeHbar} ℏ (Tier ${['FLEX','T30','T90','T180'][mintTier]}) for SAUCE rewards`);
      } catch (stakeErr) {
        // stake failure is non-fatal — mint already succeeded
        setDoneMsg(`Minted ${(Number(mintPreview)/Math.pow(10,selectedToken.decimals)).toFixed(4)} ${selectedToken.symbol}\n(Auto-stake skipped: ${stakeErr.message?.slice(0,40)})`);
      }
      setStep(S.DONE); setShowParticles(true); setTimeout(()=>setShowParticles(false),3000);
      await loadTokens();
    } catch(err) { setErrMsg(err.message??'Unknown error'); setStep(S.ERROR); }
  }

  async function handleBurn() {
    if (!isConnected||!accountId||!selectedToken||!burnAmount||parseFloat(burnAmount)<=0) return;
    resetFlow();
    try {
      const rawAmt=BigInt(Math.floor(parseFloat(burnAmount)*Math.pow(10,selectedToken.decimals)));
      setStep(S.APPROVING);
      const tokenId=selectedToken.hederaTokenId??await mirrorGetTokenIdFromEvmAddress(selectedToken.evmAddress);
      if (!tokenId) throw new Error('Cannot resolve HTS token ID.');
      await approveTokenAllowance([{ tokenId, amount:Number(rawAmt) }],SYNTH_MINTER_CONTRACT_ID);
      setStep(S.CONFIRMING);
      const txIdOrHash=await writeContract({ contractId:ContractId.fromString(SYNTH_MINTER_CONTRACT_ID), abi:SYNTH_MINTER_ABI, functionName:'burnSynth', args:[selectedToken.evmAddress,rawAmt], metaArgs:{ gas:600_000 } });
      setStep(S.PENDING);
      await watchTx(txIdOrHash);
      setDoneMsg(`Burned ${burnAmount} ${selectedToken.symbol}\n→ ${burnPreview?(Number(burnPreview)/1e8).toFixed(5):'?'} ℏ returned`);
      setStep(S.DONE); setShowParticles(true); setTimeout(()=>setShowParticles(false),3000);
      await loadTokens();
    } catch(err) { setErrMsg(err.message??'Unknown error'); setStep(S.ERROR); }
  }

  async function handleStartStream() {
    if (!isConnected||!accountId||!selectedToken||!streamRecipient||!streamRate||!streamDeposit) return;
    resetFlow();
    try {
      const depositAmt=BigInt(streamDeposit);
      setStep(S.APPROVING);
      const tokenId=selectedToken.hederaTokenId??await mirrorGetTokenIdFromEvmAddress(selectedToken.evmAddress);
      if (!tokenId) throw new Error('Cannot resolve HTS token ID.');
      await approveTokenAllowance([{ tokenId, amount:Number(depositAmt) }],SYNTH_MINTER_CONTRACT_ID);
      setStep(S.CONFIRMING);
      const txIdOrHash=await writeContract({ contractId:ContractId.fromString(SYNTH_MINTER_CONTRACT_ID), abi:SYNTH_MINTER_ABI, functionName:'startStreamWithDeposit', args:[selectedToken.evmAddress,streamRecipient,BigInt(streamRate),depositAmt], metaArgs:{ gas:500_000 } });
      setStep(S.PENDING);
      await watchTx(txIdOrHash);
      setDoneMsg(`Stream started!\n${streamRate} ${selectedToken.symbol}/sec`);
      setStep(S.DONE); setShowParticles(true); setTimeout(()=>setShowParticles(false),3000);
      await loadStreamInfo();
    } catch(err) { setErrMsg(err.message??'Unknown error'); setStep(S.ERROR); }
  }

  async function handleCancelStream() {
    if (!isConnected||!accountId||!selectedToken) return;
    resetFlow();
    try {
      setStep(S.CONFIRMING);
      const txIdOrHash=await writeContract({ contractId:ContractId.fromString(SYNTH_MINTER_CONTRACT_ID), abi:SYNTH_MINTER_ABI, functionName:'cancelStream', args:[selectedToken.evmAddress], metaArgs:{ gas:300_000 } });
      setStep(S.PENDING);
      await watchTx(txIdOrHash);
      setDoneMsg('Stream cancelled\nRemaining tokens refunded');
      setStep(S.DONE); setActiveStream(null);
    } catch(err) { setErrMsg(err.message??'Unknown error'); setStep(S.ERROR); }
  }

  async function handleClaim() {
    if (!isConnected||!accountId||!selectedToken||!claimStreamer||!claimable||claimable===0n) return;
    resetFlow();
    try {
      setStep(S.CONFIRMING);
      const txIdOrHash=await writeContract({ contractId:ContractId.fromString(SYNTH_MINTER_CONTRACT_ID), abi:SYNTH_MINTER_ABI, functionName:'claimStream', args:[claimStreamer,selectedToken.evmAddress], metaArgs:{ gas:350_000 } });
      setStep(S.PENDING);
      await watchTx(txIdOrHash);
      const claimed=claimable?(Number(claimable)/Math.pow(10,selectedToken.decimals)).toFixed(4):'?';
      setDoneMsg(`Claimed ${claimed} ${selectedToken.symbol}`);
      setStep(S.DONE); setShowParticles(true); setTimeout(()=>setShowParticles(false),3000);
    } catch(err) { setErrMsg(err.message??'Unknown error'); setStep(S.ERROR); }
  }

  // ── HANDLE UNSTAKE ──
  async function handleUnstake(positionIndex) {
    if (!isConnected||!accountId) return;
    resetFlow();
    try {
      setStep(S.CONFIRMING);
      const txIdOrHash = await writeContract({
        contractId: ContractId.fromString(SAUCE_STAKING_CONTRACT_ID),
        abi: SAUCE_STAKING_ABI,
        functionName: 'unstake',
        args: [BigInt(positionIndex)],
        metaArgs: { gas: 400_000 },
      });
      setStep(S.PENDING);
      await watchTx(txIdOrHash);
      setDoneMsg(`Unstaked position #${positionIndex}\nRewards claimed!`);
      setStep(S.DONE); setShowParticles(true); setTimeout(()=>setShowParticles(false),3000);
      await loadRewards();
    } catch(err) { setErrMsg(err.message??'Unknown error'); setStep(S.ERROR); }
  }

  // ── HANDLE LIST PRODUCT ──
  async function handleListProduct() {
    if (!isConnected||!accountId||!listName||!listPayToken||!listPrice) return;
    resetFlow();
    try {
      setStep(S.CONFIRMING);
      const txIdOrHash = await writeContract({
        contractId: ContractId.fromString(SAUCE_STAKING_CONTRACT_ID),
        abi: SAUCE_STAKING_ABI,
        functionName: 'listProduct',
        args: [listName, listDesc, listPayToken, BigInt(listPrice)],
        metaArgs: { gas: 300_000 },
      });
      setStep(S.PENDING);
      await watchTx(txIdOrHash);
      setDoneMsg(`Product "${listName}" listed!`);
      setStep(S.DONE); setShowParticles(true); setTimeout(()=>setShowParticles(false),3000);
      setListName(''); setListDesc(''); setListPayToken(''); setListPrice('');
    } catch(err) { setErrMsg(err.message??'Unknown error'); setStep(S.ERROR); }
  }

  // ── HANDLE BUY PRODUCT ──
  async function handleBuyProduct(productId, paymentToken, price, tokenHederaId) {
    if (!isConnected||!accountId) return;
    resetFlow();
    try {
      setStep(S.APPROVING);
      if (tokenHederaId) {
        await approveTokenAllowance([{ tokenId: tokenHederaId, amount: Number(price) }], SAUCE_STAKING_CONTRACT_ID);
      }
      setStep(S.CONFIRMING);
      const txIdOrHash = await writeContract({
        contractId: ContractId.fromString(SAUCE_STAKING_CONTRACT_ID),
        abi: SAUCE_STAKING_ABI,
        functionName: 'buyProduct',
        args: [BigInt(productId)],
        metaArgs: { gas: 300_000 },
      });
      setStep(S.PENDING);
      await watchTx(txIdOrHash);
      setDoneMsg(`Product purchased!`);
      setStep(S.DONE); setShowParticles(true); setTimeout(()=>setShowParticles(false),3000);
      await loadMarket();
    } catch(err) { setErrMsg(err.message??'Unknown error'); setStep(S.ERROR); }
  }

  // ── ADMIN: Set SAUCE token ──
  async function handleSetSauceToken() {
    if (!isConnected||!accountId||!adminSauceAddr) return;
    resetFlow();
    try {
      setStep(S.CONFIRMING);
      const txIdOrHash = await writeContract({
        contractId: ContractId.fromString(SAUCE_STAKING_CONTRACT_ID),
        abi: SAUCE_STAKING_ABI,
        functionName: 'setSauceToken',
        args: [adminSauceAddr, parseInt(adminSauceDec)],
        metaArgs: { gas: 14_000_000 },
      });
      setStep(S.PENDING);
      await watchTx(txIdOrHash);
      setDoneMsg(`SAUCE token set!\n${adminSauceAddr}`);
      setStep(S.DONE);
      await loadAdminInfo();
    } catch(err) { setErrMsg(err.message??'Unknown error'); setStep(S.ERROR); }
  }

  // ── ADMIN: Fund SAUCE rewards ──
  async function handleFundSauce() {
    if (!isConnected||!accountId||!adminFundAmt||!adminSauceTokenId) return;
    resetFlow();
    try {
      const amtBig = BigInt(adminFundAmt);
      setStep(S.APPROVING);
      await approveTokenAllowance([{ tokenId: adminSauceTokenId, amount: Number(amtBig) }], SAUCE_STAKING_CONTRACT_ID);
      setStep(S.CONFIRMING);
      const txIdOrHash = await writeContract({
        contractId: ContractId.fromString(SAUCE_STAKING_CONTRACT_ID),
        abi: SAUCE_STAKING_ABI,
        functionName: 'fundSauceRewards',
        args: [amtBig],
        metaArgs: { gas: 200_000 },
      });
      setStep(S.PENDING);
      await watchTx(txIdOrHash);
      setDoneMsg(`Funded ${adminFundAmt} tinySAUCE to reward pool`);
      setStep(S.DONE);
      await loadAdminInfo();
    } catch(err) { setErrMsg(err.message??'Unknown error'); setStep(S.ERROR); }
  }

  const busy          = step!==S.IDLE&&step!==S.DONE&&step!==S.ERROR;
  const activeTabData = TABS.find(t=>t.id===activeTab);
  const txStepData    = TX_STEPS[step];

  const visibleTabs = [
    ...TABS.filter(t=>MAIN_TABS.includes(t.id)),
    ...TABS.filter(t=>EXTRA_TABS.includes(t.id)),
    ...(isAdmin ? TABS.filter(t=>ADMIN_TABS.includes(t.id)) : []),
  ];

  const TIER_NAMES = ['FLEX','T30','T90','T180'];
  const TIER_COLORS = ['#94a3b8','#3b9eff','#a78bfa','#f59e0b'];

  return (
    <>
      <GlobalStyles />
      <div style={{ position:'fixed', inset:0, background:'#080b10', zIndex:0 }}>
        <HexGrid color="#00e5a0" opacity={0.022} />
        <div style={{ position:'absolute', top:-100, left:'50%', transform:'translateX(-50%)', width:600, height:400, background:'radial-gradient(ellipse,rgba(0,229,160,0.055) 0%,transparent 65%)', pointerEvents:'none' }} />
        <div style={{ position:'absolute', left:0, top:'20%', width:200, height:400, background:`radial-gradient(ellipse at left, ${activeTabData?.color}08 0%, transparent 70%)`, transition:'background .6s ease', pointerEvents:'none' }} />
        <div style={{ position:'absolute', right:0, top:'40%', width:200, height:400, background:`radial-gradient(ellipse at right, ${activeTabData?.color}06 0%, transparent 70%)`, transition:'background .6s ease', pointerEvents:'none' }} />
      </div>

      <SideDecoration side="left"  activeTab={activeTab} />
      <SideDecoration side="right" activeTab={activeTab} />
      <TickerTape hbarPrice={hbarPrice} />

      <div style={{ position:'fixed', inset:0, display:'flex', alignItems:'stretch', justifyContent:'center', zIndex:10, pointerEvents:'none' }}>
        <div style={{ width:'100%', maxWidth:430, background:'transparent', position:'relative', pointerEvents:'auto', boxShadow:'0 0 0 1px rgba(255,255,255,0.04), 0 40px 120px rgba(0,0,0,0.8)' }}>
       <div style={{ position:'absolute', inset:0, background:'rgba(8,11,16,0.97)', display:'flex', flexDirection:'column', fontFamily:"'Space Grotesk',sans-serif", color:'#dde4ee', overflow:'clip' }}>

            <div style={{ height:12, flexShrink:0 }} />

            {/* ── HEADER ── */}
            <div style={{ position:'relative', zIndex:10, flexShrink:0, padding:'8px 20px 12px', display:'flex', alignItems:'center', justifyContent:'space-between', borderBottom:'1px solid rgba(255,255,255,0.05)', background:'rgba(8,11,16,0.9)', backdropFilter:'blur(20px)' }}>
              <div>
                <div style={{ fontSize:18, fontWeight:800, letterSpacing:-0.5, lineHeight:1 }}>Synth<span style={{ color:'#00e5a0' }}>Protocol</span></div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8, color:'rgba(0,229,160,0.5)', letterSpacing:2.5, marginTop:2 }}>TESTNET</div>
              </div>
              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                <div style={{ padding:'6px 11px', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:50, display:'flex', alignItems:'center', gap:5 }}>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8, color:'rgba(255,255,255,0.3)', letterSpacing:1 }}>ℏ</span>
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:hbarPrice?'#dde4ee':'rgba(255,255,255,0.3)' }}>{hbarPrice?`$${(Number(hbarPrice)/1e8).toFixed(4)}`:'—'}</span>
                </div>
                {isAdmin && <div style={{ padding:'4px 8px', background:'rgba(239,68,68,0.1)', border:'1px solid rgba(239,68,68,0.3)', borderRadius:50, fontFamily:"'JetBrains Mono',monospace", fontSize:8, color:'#ef4444', letterSpacing:1 }}>ADMIN</div>}
                <button onClick={()=>setShowProfile(!showProfile)} style={{ display:'flex', alignItems:'center', gap:6, padding:'6px 12px', borderRadius:50, background:'rgba(0,229,160,0.06)', border:'1px solid rgba(0,229,160,0.18)', cursor:'pointer' }}>
                  <PulseDot color="#00e5a0" size={6} />
                  <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'#00e5a0' }}>{accountId?.toString().split('.').pop()??'—'}</span>
                </button>
              </div>
            </div>

            {/* ── PROFILE DRAWER ── */}
            {showProfile && (
              <>
                <div onClick={()=>setShowProfile(false)} style={{ position:'absolute', inset:0, zIndex:99 }} />
                <div style={{ position:'absolute', top:72, right:16, zIndex:100, width:240, background:'#111620', border:'1px solid rgba(255,255,255,0.1)', borderRadius:20, overflow:'hidden', boxShadow:'0 20px 60px rgba(0,0,0,0.6)', animation:'fade-scale .2s ease' }}>
                  <div style={{ padding:'16px 18px', borderBottom:'1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize:10, color:'rgba(255,255,255,0.3)', fontFamily:"'JetBrains Mono',monospace", marginBottom:4 }}>ACCOUNT</div>
                    <div style={{ fontSize:13, color:'#00e5a0', fontFamily:"'JetBrains Mono',monospace" }}>{accountId?.toString()}</div>
                    {hederaEvmAddress&&<div style={{ fontSize:10, color:'rgba(255,255,255,0.3)', fontFamily:"'JetBrains Mono',monospace", marginTop:4 }}>{hederaEvmAddress.slice(0,16)}…{hederaEvmAddress.slice(-6)}</div>}
                  </div>
                  <div style={{ padding:'8px' }}>
                    {[
                      { label:'↻ Refresh Price',  action:()=>{ loadHbarPrice(); setShowProfile(false); }, color:'rgba(255,255,255,0.5)' },
                      { label:'↻ Refresh Tokens', action:()=>{ loadTokens(); setShowProfile(false); }, color:'rgba(255,255,255,0.5)' },
                      { label:'✕ Disconnect',     action:()=>{ disconnect(); setShowProfile(false); }, color:'#ff4d6d' },
                    ].map(b=>(<button key={b.label} onClick={b.action} style={{ width:'100%', padding:'10px 12px', background:'transparent', border:'none', borderRadius:12, color:b.color, fontSize:13, cursor:'pointer', textAlign:'left', fontFamily:"'Space Grotesk',sans-serif" }}>{b.label}</button>))}
                  </div>
                </div>
              </>
            )}

            {/* ── TAB SCROLL BAR (secondary tabs) ── */}
           {/* ── SECONDARY TABS (scrollable) ── */}


            {/* ── SCROLL AREA ── */}
           <div style={{ flex:1, overflowY:'auto', overflowX:'hidden', padding:'0 0 120px', position:'relative', zIndex:1, WebkitOverflowScrolling:'touch', scrollbarWidth:'none' }}>
              {/* Hero strip */}
              <div style={{ padding:'14px 20px 0', animation:'fade-in .4s ease' }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                  <div>
                    <div style={{ fontSize:11, color:'rgba(255,255,255,0.3)', fontFamily:"'JetBrains Mono',monospace", letterSpacing:2, textTransform:'uppercase', marginBottom:2 }}>Mode</div>
                    <div style={{ fontSize:24, fontWeight:800, letterSpacing:-0.5, color:activeTabData?.color, lineHeight:1, transition:'color .3s' }}>{activeTabData?.label}</div>
                  </div>
                  <div style={{ width:44, height:44, borderRadius:14, background:`${activeTabData?.color}14`, border:`1px solid ${activeTabData?.color}30`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, color:activeTabData?.color, transition:'all .3s' }}>{activeTabData?.icon}</div>
                </div>
                <div style={{ display:'flex', gap:8, marginBottom:4 }}>
                  {[{ label:'Tokens', val:synthTokens.length, color:'#00e5a0' },{ label:'Network', val:'Testnet', color:'#3b9eff' },{ label:'Collat.', val:'150%', color:'#ffb340' }].map(s=>(
                    <div key={s.label} style={{ flex:1, padding:'8px 10px', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.06)', borderRadius:12 }}>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:7, color:'rgba(255,255,255,0.3)', letterSpacing:1.5, marginBottom:2 }}>{s.label}</div>
                      <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:s.color, fontWeight:600 }}>{s.val}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* ─── CREATE ─── */}
              {activeTab==='create'&&(
                <div style={{ padding:'12px 20px 0', animation:'fade-in .3s ease' }}>
                  <Card>
                    <CardHeader title="Token Template" icon="✦" color="#00e5a0" />
                    <CardBody>
                      <Field label="Quick Preset">
                        <div style={{ display:'flex', gap:7, flexWrap:'wrap' }}>
                          {FIAT_PRESETS.map(p=>(<Pill key={p.label} active={createSymbol===p.label} onClick={()=>{ setCreateSymbol(p.label); setCreateName(`Synthetic ${p.label.slice(1)}`); setCreateFiat(p.fiatUnitsPerUsd); setCreateDecimals(String(p.decimals)); }}>{p.label}</Pill>))}
                        </div>
                      </Field>
                      <Grid2>
                        <Field label="Name"><Input value={createName} onChange={e=>setCreateName(e.target.value)} placeholder="Synthetic USD" /></Field>
                        <Field label="Symbol"><Input value={createSymbol} onChange={e=>setCreateSymbol(e.target.value.toUpperCase())} placeholder="sUSD" /></Field>
                      </Grid2>
                      <Field label="Memo"><Input value={createMemo} onChange={e=>setCreateMemo(e.target.value)} placeholder={`Synthetic ${createSymbol||'token'}`} /></Field>
                      <Grid2>
                        <Field label="Decimals"><Input type="number" value={createDecimals} onChange={e=>setCreateDecimals(e.target.value)} placeholder="6" /></Field>
                        <Field label="Max Supply"><Input type="number" value={createMaxSup} onChange={e=>setCreateMaxSup(e.target.value)} placeholder="0=∞" /></Field>
                      </Grid2>
                      <Field label="Fiat Units / USD">
                        <Input type="number" value={createFiat} onChange={e=>setCreateFiat(e.target.value)} placeholder="1000000" />
                        <div style={{ fontSize:9, color:'rgba(255,255,255,0.25)', marginTop:5, fontFamily:"'JetBrains Mono',monospace", lineHeight:1.7 }}>sUSD=1,000,000 · sEUR=910,000 · sINR=84,000,000</div>
                      </Field>
                    </CardBody>
                    <CardFooter><ActionBtn color="#00e5a0" disabled={!isConnected||!createName||!createSymbol||busy} onClick={handleCreate}>{!isConnected?'Connect HashPack':`Deploy ${createSymbol||'Token'} — ${CREATE_TOKEN_FEE_HBAR} ℏ`}</ActionBtn></CardFooter>
                  </Card>
                </div>
              )}

              {/* ─── MINT + AUTO STAKE ─── */}
              {activeTab==='mint'&&(
                <div style={{ padding:'12px 20px 0', animation:'fade-in .3s ease' }}>
                  <Card>
                    <CardHeader title="Send HBAR → Receive Synths + Earn SAUCE" icon="↑" color="#3b9eff" />
                    <CardBody>
                      <Field label="Token"><TokenSel tokens={synthTokens} selected={selectedToken} onSelect={setSelectedToken} loading={tokensLoading} color="#3b9eff" onRefresh={loadTokens} /></Field>
                      <Field label="HBAR Amount"><BigInput value={mintHbar} onChange={e=>setMintHbar(e.target.value)} suffix="ℏ" /></Field>
                      <ConvStrip fromLabel="You Send" fromVal={`${mintHbar||'—'} ℏ`} toLabel="You Receive" toVal={mintLoading?null:mintPreview!==null?`${(Number(mintPreview)/Math.pow(10,selectedToken?.decimals??6)).toFixed(4)} ${selectedToken?.symbol??''}`:null} loading={mintLoading} color="#3b9eff" />
                      <Field label="Auto-Stake Tier">
                        <div style={{ display:'flex', gap:6 }}>
                          {TIER_NAMES.map((n,i)=>(
                            <button key={n} onClick={()=>setMintTier(i)} style={{ flex:1, padding:'8px 4px', borderRadius:10, border:`1px solid ${mintTier===i?TIER_COLORS[i]:'rgba(255,255,255,0.08)'}`, background:mintTier===i?`${TIER_COLORS[i]}15`:'rgba(255,255,255,0.03)', color:mintTier===i?TIER_COLORS[i]:'rgba(255,255,255,0.35)', fontSize:10, fontWeight:600, cursor:'pointer', fontFamily:"'JetBrains Mono',monospace", transition:'all .18s' }}>{n}</button>
                          ))}
                        </div>
                        <div style={{ fontSize:9, color:'rgba(255,255,255,0.25)', marginTop:5, fontFamily:"'JetBrains Mono',monospace" }}>FLEX=no lock · T30=2%/min,30m · T90=12%APY,90d · T180=20%APY,180d</div>
                      </Field>
                      <div style={{ padding:'10px 12px', background:'rgba(245,158,11,0.05)', border:'1px solid rgba(245,158,11,0.15)', borderRadius:12, marginBottom:4 }}>
                        <div style={{ fontSize:10, color:'#f59e0b', fontFamily:"'JetBrains Mono',monospace", letterSpacing:1 }}>★ AUTO-STAKE</div>
                        <div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', marginTop:3 }}>Your HBAR will also be staked in {TIER_NAMES[mintTier]} tier to earn SAUCE rewards. View in Rewards tab.</div>
                      </div>
                    </CardBody>
                    <CardFooter><ActionBtn color="#3b9eff" disabled={!isConnected||!selectedToken||!mintPreview||mintPreview<=0n||busy} onClick={handleMint}>{!isConnected?'Connect HashPack':!selectedToken?'Select Token':`Mint ${selectedToken.symbol} + Stake`}</ActionBtn></CardFooter>
                  </Card>
                </div>
              )}

              {/* ─── BURN ─── */}
              {activeTab==='burn'&&(
                <div style={{ padding:'12px 20px 0', animation:'fade-in .3s ease' }}>
                  <Card>
                    <CardHeader title="Return Synths → Reclaim ℏ" icon="↓" color="#ff4d6d" />
                    <CardBody>
                      <Field label="Token"><TokenSel tokens={synthTokens} selected={selectedToken} onSelect={setSelectedToken} loading={tokensLoading} color="#ff4d6d" onRefresh={loadTokens} /></Field>
                      {selectedToken?.hederaTokenId&&(<div style={{ marginBottom:14, padding:'8px 12px', background:'rgba(0,229,160,0.04)', border:'1px solid rgba(0,229,160,0.12)', borderRadius:10, display:'flex', gap:8 }}><span style={{ fontSize:10, color:'rgba(255,255,255,0.3)', fontFamily:"'JetBrains Mono',monospace" }}>ID:</span><span style={{ fontSize:10, color:'#00e5a0', fontFamily:"'JetBrains Mono',monospace" }}>{selectedToken.hederaTokenId}</span></div>)}
                      <Field label="Amount to Burn"><BigInput value={burnAmount} onChange={e=>setBurnAmount(e.target.value)} suffix={selectedToken?.symbol??'TOKEN'} disabled={!selectedToken} placeholder="0.00" /></Field>
                      <ConvStrip fromLabel="You Burn" fromVal={`${burnAmount||'—'} ${selectedToken?.symbol??''}`} toLabel="You Receive" toVal={burnLoading?null:burnPreview!==null?`${(Number(burnPreview)/1e8).toFixed(5)} ℏ`:null} loading={burnLoading} color="#ff4d6d" />
                    </CardBody>
                    <CardFooter><ActionBtn color="#ff4d6d" disabled={!isConnected||!selectedToken||!burnAmount||parseFloat(burnAmount)<=0||busy} onClick={handleBurn}>{!isConnected?'Connect HashPack':!selectedToken?'Select Token':`Approve & Burn ${selectedToken?.symbol??''}`}</ActionBtn></CardFooter>
                  </Card>
                </div>
              )}

              {/* ─── STREAM ─── */}
              {activeTab==='stream'&&(
                <div style={{ padding:'12px 20px 0', animation:'fade-in .3s ease' }}>
                  <Card>
                    <CardHeader title="Payment Stream" icon="⟿" color="#a78bfa" />
                    <CardBody>
                      <Field label="Token"><TokenSel tokens={synthTokens} selected={selectedToken} onSelect={setSelectedToken} loading={tokensLoading} color="#a78bfa" onRefresh={loadTokens} /></Field>
                      {activeStream?(
                        <>
                          <div style={{ padding:'14px', background:'rgba(167,139,250,0.05)', border:'1px solid rgba(167,139,250,0.18)', borderRadius:16, marginBottom:14 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:12 }}><PulseDot color="#a78bfa" /><span style={{ fontSize:11, fontWeight:600, color:'#a78bfa', fontFamily:"'JetBrains Mono',monospace", letterSpacing:1 }}>LIVE STREAM</span></div>
                            {[{ k:'Recipient', v:`${activeStream.recipient.slice(0,12)}…${activeStream.recipient.slice(-6)}` },{ k:'Rate', v:`${activeStream.amountPerSecond?.toString()} units/sec` },{ k:'Remaining', v:`${selectedToken?(Number(activeStream.remainingDeposited)/Math.pow(10,selectedToken.decimals)).toFixed(4):activeStream.remainingDeposited?.toString()} ${selectedToken?.symbol??''}` }].map(r=>(<div key={r.k} style={{ display:'flex', justifyContent:'space-between', padding:'7px 0', borderBottom:'1px solid rgba(255,255,255,0.04)', fontSize:12 }}><span style={{ color:'rgba(255,255,255,0.3)' }}>{r.k}</span><span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11 }}>{r.v}</span></div>))}
                          </div>
                          <ActionBtn color="#ff4d6d" disabled={busy} onClick={handleCancelStream} variant="danger">✕ Cancel Stream & Refund</ActionBtn>
                        </>
                      ):(
                        <>
                          <Field label="Recipient EVM Address">
                            <Input value={streamRecipient} onChange={e=>setStreamRecipient(e.target.value)} placeholder="0xabc…" />
                            {hederaEvmAddress&&<button onClick={()=>setStreamRecipient(hederaEvmAddress)} style={{ marginTop:6, padding:'5px 11px', background:'rgba(0,229,160,0.05)', border:'1px solid rgba(0,229,160,0.15)', borderRadius:8, color:'rgba(255,255,255,0.35)', fontSize:10, cursor:'pointer', fontFamily:"'JetBrains Mono',monospace" }}>Use my address</button>}
                          </Field>
                          <Grid2>
                            <Field label="Rate (units/s)"><Input type="number" value={streamRate} onChange={e=>setStreamRate(e.target.value)} placeholder="100" /></Field>
                            <Field label="Deposit (units)"><Input type="number" value={streamDeposit} onChange={e=>setStreamDeposit(e.target.value)} placeholder="5000" /></Field>
                          </Grid2>
                          {streamRate&&streamDeposit&&parseInt(streamDeposit)>=parseInt(streamRate)&&(<ConvStrip fromLabel="Duration" fromVal={`~${(parseInt(streamDeposit)/parseInt(streamRate)).toFixed(0)}s`} toLabel="Minutes" toVal={`${((parseInt(streamDeposit)/parseInt(streamRate))/60).toFixed(2)}m`} color="#a78bfa" />)}
                          <div style={{ marginTop:14 }}><ActionBtn color="#a78bfa" disabled={!isConnected||!selectedToken||!streamRecipient||busy} onClick={handleStartStream}>{!isConnected?'Connect HashPack':!selectedToken?'Select Token':'Approve & Start Stream'}</ActionBtn></div>
                        </>
                      )}
                    </CardBody>
                  </Card>
                </div>
              )}

              {/* ─── CLAIM STREAM ─── */}
              {activeTab==='claim'&&(
                <div style={{ padding:'12px 20px 0', animation:'fade-in .3s ease' }}>
                  <Card>
                    <CardHeader title="Claim Accrued Tokens" icon="◎" color="#ffb340" />
                    <CardBody>
                      <Field label="Token"><TokenSel tokens={synthTokens} selected={selectedToken} onSelect={setSelectedToken} loading={tokensLoading} color="#ffb340" onRefresh={loadTokens} /></Field>
                      <Field label="Streamer Address">
                        <Input value={claimStreamer} onChange={e=>setClaimStreamer(e.target.value)} placeholder="0xabc… (stream creator)" />
                        {hederaEvmAddress&&<button onClick={()=>setClaimStreamer(hederaEvmAddress)} style={{ marginTop:6, padding:'5px 11px', background:'rgba(0,229,160,0.05)', border:'1px solid rgba(0,229,160,0.15)', borderRadius:8, color:'rgba(255,255,255,0.35)', fontSize:10, cursor:'pointer', fontFamily:"'JetBrains Mono',monospace" }}>Use my address</button>}
                      </Field>
                      {claimLoading&&<ConvStrip fromLabel="Checking…" fromVal="…" loading={true} color="#ffb340" />}
                      {!claimLoading&&claimable!==null&&selectedToken&&claimable>0n&&(<ConvStrip fromLabel="Claimable Now" fromVal={`${(Number(claimable)/Math.pow(10,selectedToken.decimals)).toFixed(4)} ${selectedToken.symbol}`} toLabel="" toVal="💰" color="#ffb340" />)}
                      {!claimLoading&&claimable===0n&&claimStreamer&&(<div style={{ textAlign:'center', padding:'14px 0', color:'rgba(255,255,255,0.25)', fontSize:12, fontFamily:"'JetBrains Mono',monospace" }}>Nothing to claim yet</div>)}
                    </CardBody>
                    <CardFooter><ActionBtn color="#ffb340" disabled={!isConnected||!selectedToken||!claimStreamer||!claimable||claimable===0n||busy} onClick={handleClaim}>{!isConnected?'Connect HashPack':!selectedToken?'Select Token':!claimStreamer?'Enter Streamer Address':'Claim Tokens'}</ActionBtn></CardFooter>
                  </Card>
                </div>
              )}

              {/* ─── REWARDS (STAKING) ─── */}
              {activeTab==='rewards'&&(
                <div style={{ padding:'12px 20px 0', animation:'fade-in .3s ease' }}>
                  <Card>
                    <CardHeader title="SAUCE Staking Rewards" icon="★" color="#f59e0b" />
                    <CardBody>
                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:14 }}>
                        <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)' }}>{stakePositions.length} active position{stakePositions.length!==1?'s':''}</div>
                        <button onClick={loadRewards} style={{ padding:'6px 12px', background:'rgba(245,158,11,0.07)', border:'1px solid rgba(245,158,11,0.2)', borderRadius:8, color:'#f59e0b', fontSize:11, cursor:'pointer', fontFamily:"'JetBrains Mono',monospace" }}>↻ Refresh</button>
                      </div>
                      {rewardsLoading&&(<div style={{ textAlign:'center', padding:'30px 0', color:'rgba(255,255,255,0.25)', fontSize:12 }}><div style={{ width:24, height:24, borderRadius:'50%', border:'2px solid rgba(245,158,11,0.3)', borderTopColor:'#f59e0b', animation:'spin 1s linear infinite', margin:'0 auto 10px' }} />Loading positions…</div>)}
                      {!rewardsLoading&&stakePositions.length===0&&(
                        <div style={{ textAlign:'center', padding:'30px 0' }}>
                          <div style={{ fontSize:32, marginBottom:10 }}>★</div>
                          <div style={{ fontSize:13, color:'rgba(255,255,255,0.35)', lineHeight:1.7 }}>No active stake positions.<br />Mint synths to auto-stake and earn SAUCE.</div>
                        </div>
                      )}
                      {!rewardsLoading&&stakePositions.map((pos, i)=>{
                        const reward = positionRewards[i] ?? 0n;
                        const isLocked = Number(pos.unlockTime) > Date.now()/1000;
                        const tierName = TIER_NAMES[pos.tier]??'UNKNOWN';
                        const tierColor = TIER_COLORS[pos.tier]??'#94a3b8';
                        const unlockDate = new Date(Number(pos.unlockTime)*1000).toLocaleString();
                        return (
                          <div key={i} style={{ marginBottom:12, padding:'14px', background:`${tierColor}08`, border:`1px solid ${tierColor}20`, borderRadius:16, animation:'reward-glow 3s ease-in-out infinite' }}>
                            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
                              <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                                <div style={{ padding:'3px 10px', background:`${tierColor}18`, border:`1px solid ${tierColor}30`, borderRadius:50, fontSize:10, color:tierColor, fontFamily:"'JetBrains Mono',monospace", fontWeight:700 }}>{tierName}</div>
                                {isLocked&&<div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', fontFamily:"'JetBrains Mono',monospace" }}>🔒 LOCKED</div>}
                              </div>
                              <div style={{ fontSize:10, color:'rgba(255,255,255,0.3)', fontFamily:"'JetBrains Mono',monospace" }}>#{Number(pos.positionId)}</div>
                            </div>
                            {[
                              { k:'Principal', v:`${(Number(pos.amount)/1e8).toFixed(4)} ℏ` },
                              { k:'Accrued SAUCE', v:`${(Number(reward)/1e8).toFixed(6)} SAUCE` },
                              { k:'Unlock', v:pos.tier===0?'Anytime':unlockDate },
                            ].map(r=>(<div key={r.k} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', fontSize:12 }}><span style={{ color:'rgba(255,255,255,0.35)' }}>{r.k}</span><span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color: r.k==='Accrued SAUCE'?'#f59e0b':'#dde4ee' }}>{r.v}</span></div>))}
                            <div style={{ marginTop:12, display:'flex', gap:8 }}>
                              <ActionBtn color={isLocked?'#ff4d6d':'#f59e0b'} disabled={busy} onClick={()=>handleUnstake(i)} variant={isLocked?'danger':'primary'}>
                                {isLocked?'⚠ Early Exit (10% penalty)':'Unstake & Claim SAUCE'}
                              </ActionBtn>
                            </div>
                          </div>
                        );
                      })}
                    </CardBody>
                  </Card>
                </div>
              )}

              {/* ─── LIST PRODUCT ─── */}
              {activeTab==='list'&&(
                <div style={{ padding:'12px 20px 0', animation:'fade-in .3s ease' }}>
                  <Card>
                    <CardHeader title="List a Product" icon="📋" color="#10b981" />
                    <CardBody>
                      <Field label="Product Name"><Input value={listName} onChange={e=>setListName(e.target.value)} placeholder="My Digital Asset" /></Field>
                      <Field label="Description"><Input value={listDesc} onChange={e=>setListDesc(e.target.value)} placeholder="What are you selling?" /></Field>
                      <Field label="Payment Token (EVM address)">
                        <Input value={listPayToken} onChange={e=>setListPayToken(e.target.value)} placeholder="0x…" />
                        {synthTokens.length>0&&(
                          <div style={{ display:'flex', gap:6, marginTop:6, flexWrap:'wrap' }}>
                            {synthTokens.map(t=>(<button key={t.evmAddress} onClick={()=>setListPayToken(t.evmAddress)} style={{ padding:'4px 10px', background:'rgba(0,229,160,0.05)', border:'1px solid rgba(0,229,160,0.15)', borderRadius:8, color:'rgba(255,255,255,0.4)', fontSize:10, cursor:'pointer', fontFamily:"'JetBrains Mono',monospace" }}>{t.symbol}</button>))}
                          </div>
                        )}
                      </Field>
                      <Field label="Price (token units)"><Input type="number" value={listPrice} onChange={e=>setListPrice(e.target.value)} placeholder="1000000 (e.g. 1 sUSD = 1000000 units)" /></Field>
                    </CardBody>
                    <CardFooter><ActionBtn color="#10b981" disabled={!isConnected||!listName||!listPayToken||!listPrice||busy} onClick={handleListProduct}>{!isConnected?'Connect HashPack':'List Product'}</ActionBtn></CardFooter>
                  </Card>
                </div>
              )}

              {/* ─── MARKET ─── */}
              {activeTab==='market'&&(
                <div style={{ padding:'12px 20px 0', animation:'fade-in .3s ease' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                    <div style={{ fontSize:14, fontWeight:700 }}>Marketplace</div>
                    <button onClick={loadMarket} style={{ padding:'6px 12px', background:'rgba(6,182,212,0.07)', border:'1px solid rgba(6,182,212,0.2)', borderRadius:8, color:'#06b6d4', fontSize:11, cursor:'pointer', fontFamily:"'JetBrains Mono',monospace" }}>↻ Refresh</button>
                  </div>
                  {marketLoading&&(<div style={{ textAlign:'center', padding:'40px 0', color:'rgba(255,255,255,0.25)' }}><div style={{ width:24, height:24, borderRadius:'50%', border:'2px solid rgba(6,182,212,0.3)', borderTopColor:'#06b6d4', animation:'spin 1s linear infinite', margin:'0 auto 10px' }} />Loading products…</div>)}
                  {!marketLoading&&marketProducts.length===0&&(<div style={{ textAlign:'center', padding:'40px 0' }}><div style={{ fontSize:32, marginBottom:10 }}>🏪</div><div style={{ fontSize:13, color:'rgba(255,255,255,0.35)' }}>No products listed yet.<br />Be the first to list something!</div></div>)}
                  {!marketLoading&&marketProducts.map((p, i)=>{
                    const tokenInfo = synthTokens.find(t=>t.evmAddress.toLowerCase()===p.paymentToken.toLowerCase());
                    const priceDisplay = tokenInfo ? `${(Number(p.price)/Math.pow(10,tokenInfo.decimals)).toFixed(4)} ${tokenInfo.symbol}` : `${p.price.toString()} units`;
                    return (
                      <Card key={i}>
                        <CardBody>
                          <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', marginBottom:8 }}>
                            <div>
                              <div style={{ fontSize:15, fontWeight:700, color:'#fff', marginBottom:3 }}>{p.name}</div>
                              {p.description&&<div style={{ fontSize:11, color:'rgba(255,255,255,0.4)', lineHeight:1.5 }}>{p.description}</div>}
                            </div>
                            <div style={{ padding:'3px 10px', background:'rgba(6,182,212,0.1)', border:'1px solid rgba(6,182,212,0.25)', borderRadius:50, fontSize:10, color:'#06b6d4', fontFamily:"'JetBrains Mono',monospace", flexShrink:0 }}>#{Number(p.productId)}</div>
                          </div>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginTop:10, padding:'10px 0', borderTop:'1px solid rgba(255,255,255,0.05)' }}>
                            <div>
                              <div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', fontFamily:"'JetBrains Mono',monospace", letterSpacing:1.5 }}>PRICE</div>
                              <div style={{ fontSize:16, fontWeight:700, color:'#06b6d4' }}>{priceDisplay}</div>
                            </div>
                            <button onClick={()=>handleBuyProduct(p.productId, p.paymentToken, p.price, tokenInfo?.hederaTokenId)} disabled={busy||p.seller.toLowerCase()===hederaEvmAddress?.toLowerCase()} style={{ padding:'10px 20px', background:p.seller.toLowerCase()===hederaEvmAddress?.toLowerCase()?'rgba(255,255,255,0.04)':'linear-gradient(135deg,#06b6d4,#0891b2)', border:'none', borderRadius:12, color:p.seller.toLowerCase()===hederaEvmAddress?.toLowerCase()?'rgba(255,255,255,0.2)':'#fff', fontSize:13, fontWeight:700, cursor:p.seller.toLowerCase()===hederaEvmAddress?.toLowerCase()?'not-allowed':'pointer', fontFamily:"'Space Grotesk',sans-serif" }}>
                              {p.seller.toLowerCase()===hederaEvmAddress?.toLowerCase()?'Your listing':'Buy Now'}
                            </button>
                          </div>
                          <div style={{ fontSize:9, color:'rgba(255,255,255,0.2)', fontFamily:"'JetBrains Mono',monospace", marginTop:4 }}>Seller: {p.seller.slice(0,12)}…{p.seller.slice(-6)}</div>
                        </CardBody>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* ─── MY ITEMS ─── */}
              {activeTab==='myitems'&&(
                <div style={{ padding:'12px 20px 0', animation:'fade-in .3s ease' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                    <div style={{ fontSize:14, fontWeight:700 }}>My Purchases</div>
                    <button onClick={loadMyPurchases} style={{ padding:'6px 12px', background:'rgba(139,92,246,0.07)', border:'1px solid rgba(139,92,246,0.2)', borderRadius:8, color:'#8b5cf6', fontSize:11, cursor:'pointer', fontFamily:"'JetBrains Mono',monospace" }}>↻ Refresh</button>
                  </div>
                  {myPurchasesLoading&&(<div style={{ textAlign:'center', padding:'40px 0', color:'rgba(255,255,255,0.25)' }}><div style={{ width:24, height:24, borderRadius:'50%', border:'2px solid rgba(139,92,246,0.3)', borderTopColor:'#8b5cf6', animation:'spin 1s linear infinite', margin:'0 auto 10px' }} />Loading purchases…</div>)}
                  {!myPurchasesLoading&&myPurchases.length===0&&(<div style={{ textAlign:'center', padding:'40px 0' }}><div style={{ fontSize:32, marginBottom:10 }}>🎒</div><div style={{ fontSize:13, color:'rgba(255,255,255,0.35)' }}>No purchases yet.<br />Browse the marketplace to buy items.</div></div>)}
                  {!myPurchasesLoading&&myPurchases.map((p, i)=>{
                    const tokenInfo = synthTokens.find(t=>t.evmAddress.toLowerCase()===p.paymentToken.toLowerCase());
                    const priceDisplay = tokenInfo ? `${(Number(p.pricePaid)/Math.pow(10,tokenInfo.decimals)).toFixed(4)} ${tokenInfo.symbol}` : `${p.pricePaid.toString()} units`;
                    return (
                      <Card key={i}>
                        <CardBody>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                            <div>
                              <div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', fontFamily:"'JetBrains Mono',monospace", letterSpacing:1.5, marginBottom:4 }}>PURCHASE #{Number(p.purchaseId)} · PRODUCT #{Number(p.productId)}</div>
                              <div style={{ fontSize:15, fontWeight:700, color:'#8b5cf6', marginBottom:4 }}>Product #{Number(p.productId)}</div>
                              <div style={{ fontSize:12, color:'rgba(255,255,255,0.4)' }}>Paid: {priceDisplay}</div>
                              <div style={{ fontSize:10, color:'rgba(255,255,255,0.25)', fontFamily:"'JetBrains Mono',monospace", marginTop:4 }}>Seller: {p.seller.slice(0,12)}…{p.seller.slice(-6)}</div>
                            </div>
                            <div style={{ padding:'4px 10px', background:'rgba(0,229,160,0.08)', border:'1px solid rgba(0,229,160,0.2)', borderRadius:50, fontSize:10, color:'#00e5a0', fontFamily:"'JetBrains Mono',monospace" }}>✓ Owned</div>
                          </div>
                          <div style={{ fontSize:9, color:'rgba(255,255,255,0.2)', fontFamily:"'JetBrains Mono',monospace", marginTop:6 }}>{new Date(Number(p.purchasedAt)*1000).toLocaleString()}</div>
                        </CardBody>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* ─── ADMIN ─── */}
              {activeTab==='admin'&&isAdmin&&(
                <div style={{ padding:'12px 20px 0', animation:'fade-in .3s ease' }}>
                  {/* Pool stats */}
                  <div style={{ padding:'14px', background:'rgba(239,68,68,0.05)', border:'1px solid rgba(239,68,68,0.15)', borderRadius:16, marginBottom:14 }}>
                    <div style={{ fontSize:10, color:'rgba(239,68,68,0.7)', fontFamily:"'JetBrains Mono',monospace", letterSpacing:1.5, marginBottom:8 }}>⚙ ADMIN PANEL</div>
                    <div style={{ display:'flex', gap:8 }}>
                      <div style={{ flex:1, padding:'10px', background:'rgba(255,255,255,0.03)', borderRadius:10 }}>
                        <div style={{ fontSize:8, color:'rgba(255,255,255,0.3)', fontFamily:"'JetBrains Mono',monospace", letterSpacing:1.5, marginBottom:3 }}>SAUCE POOL</div>
                        <div style={{ fontSize:14, fontWeight:700, color:'#f59e0b' }}>{adminPoolBalance!==null?(Number(adminPoolBalance)/1e8).toFixed(4):'-'} SAUCE</div>
                      </div>
                      <div style={{ flex:1, padding:'10px', background:'rgba(255,255,255,0.03)', borderRadius:10 }}>
                        <div style={{ fontSize:8, color:'rgba(255,255,255,0.3)', fontFamily:"'JetBrains Mono',monospace", letterSpacing:1.5, marginBottom:3 }}>SAUCE TOKEN</div>
                        <div style={{ fontSize:10, color:'#00e5a0', fontFamily:"'JetBrains Mono',monospace", overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{adminSauceAddr?`${adminSauceAddr.slice(0,10)}…`:'Not set'}</div>
                      </div>
                    </div>
                    <button onClick={loadAdminInfo} style={{ marginTop:10, width:'100%', padding:'7px', background:'transparent', border:'1px solid rgba(255,255,255,0.07)', borderRadius:8, color:'rgba(255,255,255,0.3)', fontSize:11, cursor:'pointer', fontFamily:"'JetBrains Mono',monospace" }}>↻ Refresh</button>
                  </div>

                  <Card>
                    <CardHeader title="Set SAUCE Token" icon="★" color="#f59e0b" />
                    <CardBody>
                      <Field label="SAUCE EVM Address"><Input value={adminSauceAddr} onChange={e=>setAdminSauceAddr(e.target.value)} placeholder="0x…" /></Field>
                      <Field label="Decimals"><Input type="number" value={adminSauceDec} onChange={e=>setAdminSauceDec(e.target.value)} placeholder="8" /></Field>
                    </CardBody>
                    <CardFooter><ActionBtn color="#f59e0b" disabled={!adminSauceAddr||busy} onClick={handleSetSauceToken}>Set SAUCE Token</ActionBtn></CardFooter>
                  </Card>

                  <div style={{ height:12 }} />

                  <Card>
                    <CardHeader title="Fund SAUCE Reward Pool" icon="💰" color="#10b981" />
                    <CardBody>
                      <div style={{ padding:'10px 12px', background:'rgba(16,185,129,0.05)', border:'1px solid rgba(16,185,129,0.15)', borderRadius:10, marginBottom:14 }}>
                        <div style={{ fontSize:10, color:'rgba(16,185,129,0.8)', lineHeight:1.7 }}>Transfer SAUCE tokens to the staking contract first via Hashpack, then enter the amount and click Fund to credit the reward pool.</div>
                      </div>
                      <Field label="SAUCE Hedera Token ID (for approval)"><Input value={adminSauceTokenId} onChange={e=>setAdminSauceTokenId(e.target.value)} placeholder="0.0.1183558" /></Field>
                      <Field label="Amount (tinySAUCE units)"><Input type="number" value={adminFundAmt} onChange={e=>setAdminFundAmt(e.target.value)} placeholder="5000000000 = 50 SAUCE" /></Field>
                      {adminFundAmt&&<div style={{ fontSize:10, color:'rgba(255,255,255,0.3)', fontFamily:"'JetBrains Mono',monospace', marginBottom:10" }}>{(Number(adminFundAmt)/1e8).toFixed(4)} SAUCE</div>}
                    </CardBody>
                    <CardFooter><ActionBtn color="#10b981" disabled={!adminFundAmt||!adminSauceTokenId||busy} onClick={handleFundSauce}>Approve & Fund Pool</ActionBtn></CardFooter>
                  </Card>
                </div>
              )}

              {/* Admin gate for non-admins */}
              {activeTab==='admin'&&!isAdmin&&(
                <div style={{ padding:'40px 20px', textAlign:'center' }}>
                  <div style={{ fontSize:40, marginBottom:16 }}>🔒</div>
                  <div style={{ fontSize:16, fontWeight:700, color:'rgba(255,255,255,0.5)' }}>Admin Access Only</div>
                  <div style={{ fontSize:12, color:'rgba(255,255,255,0.25)', marginTop:8, fontFamily:"'JetBrains Mono',monospace" }}>This panel is restricted to the contract owner.</div>
                </div>
              )}

              {/* Error */}
              {step===S.ERROR&&(
                <div style={{ padding:'12px 20px 0' }}>
                  <div style={{ padding:16, background:'rgba(255,77,109,0.05)', border:'1px solid rgba(255,77,109,0.18)', borderRadius:16 }}>
                    <div style={{ fontSize:12, color:'#ff4d6d', fontWeight:600, marginBottom:6 }}>⚠ Transaction Failed</div>
                    <div style={{ fontSize:11, color:'rgba(255,255,255,0.35)', fontFamily:"'JetBrains Mono',monospace", lineHeight:1.6, wordBreak:'break-word' }}>{errMsg}</div>
                    <button onClick={resetFlow} style={{ marginTop:12, width:'100%', padding:'10px', background:'transparent', border:'1px solid rgba(255,255,255,0.07)', borderRadius:10, color:'rgba(255,255,255,0.35)', fontSize:12, cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif" }}>↩ Try Again</button>
                  </div>
                </div>
              )}
              <div style={{ height:16 }} />

              
            </div>

            

            {/* ── TX OVERLAY ── */}
            {busy&&txStepData&&(
              <div style={{ position:'absolute', inset:0, zIndex:200, background:'rgba(8,11,16,0.96)', backdropFilter:'blur(24px)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 32px', animation:'fade-scale .3s ease', overflow:'hidden' }}>
                <HexGrid color={step===S.APPROVING?'#ffb340':'#00e5a0'} opacity={0.04} />
                <div style={{ position:'relative', marginBottom:28 }}>
                  <RingProgress progress={txStepData.progress} size={136} color={step===S.APPROVING?'#ffb340':'#00e5a0'}>
                    <span style={{ fontSize:38 }}>{txStepData.icon}</span>
                    <span style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:11, color:'rgba(255,255,255,0.3)', marginTop:2 }}>{txStepData.progress}%</span>
                  </RingProgress>
                </div>
                <div style={{ fontSize:22, fontWeight:800, textAlign:'center', marginBottom:8, letterSpacing:-0.3 }}>{txStepData.label}</div>
                <div style={{ fontSize:13, color:'rgba(255,255,255,0.4)', textAlign:'center', marginBottom:32, fontFamily:"'JetBrains Mono',monospace" }}>{txStepData.desc}</div>
                <div style={{ width:'100%', height:3, background:'rgba(255,255,255,0.05)', borderRadius:2, overflow:'hidden', marginBottom:28 }}>
                  <div style={{ height:'100%', background:'linear-gradient(90deg,#00e5a0,#3b9eff)', borderRadius:2, width:`${txStepData.progress}%`, transition:'width .8s cubic-bezier(.4,0,.2,1)', boxShadow:'0 0 10px rgba(0,229,160,0.6)' }} />
                </div>
                <div style={{ width:'100%', display:'flex', flexDirection:'column', gap:8 }}>
                  {Object.entries(TX_STEPS).map(([key,info])=>{
                    const order=[S.APPROVING,S.CONFIRMING,S.PENDING,S.ASSOCIATING];
                    const ci=order.indexOf(step), ti=order.indexOf(key);
                    const done=ti<ci, active=key===step;
                    return (
                      <div key={key} style={{ display:'flex', alignItems:'center', gap:12, padding:'11px 16px', borderRadius:14, border:'1px solid transparent', background:active?'rgba(0,229,160,0.05)':'rgba(255,255,255,0.02)', borderColor:active?'rgba(0,229,160,0.15)':'transparent', opacity:done?0.45:1, transition:'all .3s' }}>
                        <div style={{ width:8, height:8, borderRadius:'50%', flexShrink:0, background:active||done?'#00e5a0':'rgba(255,255,255,0.15)', boxShadow:active?'0 0 10px #00e5a0':'none', transition:'all .3s' }} />
                        <span style={{ fontSize:13, fontWeight:500, flex:1 }}>{info.label}</span>
                        <span style={{ fontSize:12, color:done?'#00e5a0':active?'rgba(0,229,160,0.7)':'rgba(255,255,255,0.2)', fontFamily:"'JetBrains Mono',monospace" }}>{done?'✓':active?'●':'○'}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── SUCCESS OVERLAY ── */}
            {step===S.DONE&&(
              <div style={{ position:'absolute', inset:0, zIndex:200, background:'rgba(8,11,16,0.97)', backdropFilter:'blur(24px)', display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'40px 32px', animation:'fade-scale .35s ease', overflow:'hidden' }}>
                <Particles active={showParticles} color="#00e5a0" count={40} />
                <HexGrid color="#00e5a0" opacity={0.04} />
                <div style={{ position:'relative', marginBottom:24 }}>
                  <svg width={100} height={100} viewBox="0 0 100 100">
                    <circle cx={50} cy={50} r={46} fill="none" stroke="rgba(0,229,160,0.1)" strokeWidth={2} />
                    <circle cx={50} cy={50} r={46} fill="none" stroke="#00e5a0" strokeWidth={2.5} strokeDasharray="289" strokeDashoffset="289" strokeLinecap="round" style={{ transform:'rotate(-90deg)', transformOrigin:'50% 50%', animation:'ring-draw .7s .1s ease forwards', filter:'drop-shadow(0 0 8px #00e5a0)' }} />
                    <path d="M30 50 L44 64 L70 36" fill="none" stroke="#00e5a0" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="60" strokeDashoffset="60" style={{ animation:'check-draw .5s .7s ease forwards', filter:'drop-shadow(0 0 6px #00e5a0)' }} />
                  </svg>
                  <div style={{ position:'absolute', inset:-16, borderRadius:'50%', border:'1px solid rgba(0,229,160,0.08)', animation:'ring-out .8s .2s ease forwards' }} />
                  <div style={{ position:'absolute', inset:-32, borderRadius:'50%', border:'1px solid rgba(0,229,160,0.04)', animation:'ring-out .8s .4s ease forwards' }} />
                </div>
                <div style={{ fontSize:28, fontWeight:800, color:'#00e5a0', textAlign:'center', letterSpacing:-0.5, marginBottom:10 }}>Confirmed!</div>
                {doneMsg&&<div style={{ fontSize:13, color:'rgba(255,255,255,0.4)', textAlign:'center', whiteSpace:'pre-line', lineHeight:1.9, fontFamily:"'JetBrains Mono',monospace", marginBottom:36 }}>{doneMsg}</div>}
                <div style={{ padding:'12px 18px', background:'rgba(0,229,160,0.04)', border:'1px solid rgba(0,229,160,0.1)', borderRadius:14, marginBottom:28, width:'100%', textAlign:'center' }}>
                  <div style={{ fontSize:9, color:'rgba(255,255,255,0.25)', fontFamily:"'JetBrains Mono',monospace", letterSpacing:2, marginBottom:4 }}>TRANSACTION</div>
                  <div style={{ fontSize:10, color:'rgba(0,229,160,0.6)', fontFamily:"'JetBrains Mono',monospace" }}>Finalized on Hedera Testnet ✓</div>
                </div>
                <button onClick={resetFlow} style={{ padding:'16px 40px', borderRadius:50, background:'linear-gradient(135deg,rgba(0,229,160,0.12),rgba(0,229,160,0.04))', border:'1px solid rgba(0,229,160,0.25)', color:'#00e5a0', fontSize:15, fontWeight:700, cursor:'pointer', fontFamily:"'Space Grotesk',sans-serif", boxShadow:'0 0 30px rgba(0,229,160,0.1)' }}>↩ New Transaction</button>
              </div>
            )}

          </div>

          {/* ── BOTTOM NAV ── */}
{/* ── BOTTOM NAV ── */}
{/* ── BOTTOM NAV ── */}
{/* ── BOTTOM NAV ── */}
<div style={{
  position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 50,
  background: 'rgba(8,11,16,0.94)', backdropFilter: 'blur(24px)',
  borderTop: '1px solid rgba(255,255,255,0.06)',
  paddingBottom: 'env(safe-area-inset-bottom, 0px)',
}}>
  <NavScroll
    tabs={[
      ...TABS.filter(t => MAIN_TABS.includes(t.id)),
      ...TABS.filter(t => EXTRA_TABS.includes(t.id)),
      ...(isAdmin ? TABS.filter(t => ADMIN_TABS.includes(t.id)) : []),
    ]}
    activeTab={activeTab}
    onSelect={(id) => { setActiveTab(id); resetFlow(); }}
  />
</div>


        </div>


        
      </div>
    </>
  );
}

// ─── MICRO COMPONENTS ─────────────────────────────────────────────────────────
function Card({ children }) {
  return <div style={{ background:'rgba(17,22,32,0.9)', border:'1px solid rgba(255,255,255,0.07)', borderRadius:22, overflow:'hidden', backdropFilter:'blur(10px)', marginBottom:12 }}>{children}</div>;
}
function CardHeader({ title, icon, color }) {
  return (<div style={{ padding:'15px 18px 13px', borderBottom:'1px solid rgba(255,255,255,0.05)', display:'flex', alignItems:'center', gap:9 }}><span style={{ color, fontSize:16 }}>{icon}</span><span style={{ fontSize:14, fontWeight:700 }}>{title}</span></div>);
}
function CardBody({ children }) { return <div style={{ padding:'16px 18px' }}>{children}</div>; }
function CardFooter({ children }) { return <div style={{ padding:'0 18px 18px' }}>{children}</div>; }
function Field({ label, children }) {
  return (<div style={{ marginBottom:14 }}>{label&&<div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8, color:'rgba(255,255,255,0.25)', letterSpacing:2.5, textTransform:'uppercase', marginBottom:7 }}>{label}</div>}{children}</div>);
}
function Input({ value, onChange, placeholder, type='text', disabled=false }) {
  return (<input value={value} onChange={onChange} placeholder={placeholder} type={type} disabled={disabled} style={{ width:'100%', padding:'12px 14px', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:14, color:'#dde4ee', fontFamily:"'JetBrains Mono',monospace", fontSize:14, outline:'none', transition:'border-color .2s', WebkitAppearance:'none' }} onFocus={e=>e.target.style.borderColor='rgba(0,229,160,0.3)'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.08)'} />);
}
function BigInput({ value, onChange, suffix, disabled=false, placeholder='0' }) {
  return (<div style={{ position:'relative' }}><input value={value} onChange={onChange} type="number" disabled={disabled} placeholder={placeholder} style={{ width:'100%', padding:'15px 60px 15px 15px', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:14, color:'#fff', fontFamily:"'JetBrains Mono',monospace", fontSize:26, fontWeight:600, outline:'none', WebkitAppearance:'none', transition:'border-color .2s' }} onFocus={e=>e.target.style.borderColor='rgba(0,229,160,0.3)'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.08)'} /><span style={{ position:'absolute', right:15, top:'50%', transform:'translateY(-50%)', fontFamily:"'JetBrains Mono',monospace", fontSize:12, color:'rgba(255,255,255,0.3)', pointerEvents:'none' }}>{suffix}</span></div>);
}
function Grid2({ children }) { return <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>{children}</div>; }
function Pill({ children, active, onClick }) {
  return (<button onClick={onClick} style={{ padding:'6px 14px', borderRadius:50, cursor:'pointer', fontSize:12, fontWeight:500, border:`1px solid ${active?'rgba(0,229,160,0.4)':'rgba(255,255,255,0.09)'}`, background:active?'rgba(0,229,160,0.1)':'rgba(255,255,255,0.03)', color:active?'#00e5a0':'rgba(255,255,255,0.4)', transition:'all .18s', fontFamily:"'Space Grotesk',sans-serif" }}>{children}</button>);
}
function ConvStrip({ fromLabel, fromVal, toLabel, toVal, loading=false, color='#00e5a0' }) {
  if (!fromVal&&!loading) return null;
  return (
    <div style={{ padding:'13px 15px', background:`${color}07`, border:`1px solid ${color}18`, borderRadius:14, marginBottom:14, display:'flex', alignItems:'center', gap:12 }}>
      <div style={{ flex:1 }}>
        <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8, color:'rgba(255,255,255,0.3)', letterSpacing:2, textTransform:'uppercase', marginBottom:3 }}>{fromLabel}</div>
        <div style={{ fontSize:16, fontWeight:700, color, wordBreak:'break-word' }}>{fromVal}</div>
      </div>
      {toLabel&&<div style={{ fontSize:18, color:'rgba(255,255,255,0.2)' }}>→</div>}
      {toLabel&&(
        <div style={{ flex:1, textAlign:'right' }}>
          <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:8, color:'rgba(255,255,255,0.3)', letterSpacing:2, textTransform:'uppercase', marginBottom:3 }}>{toLabel}</div>
          {loading ? <div style={{ display:'flex', gap:3, justifyContent:'flex-end', padding:'4px 0' }}>{[0,1,2].map(i=><div key={i} style={{ width:5,height:5,borderRadius:'50%',background:color,opacity:.4,animation:`conv-pulse 1.2s ${i*.2}s ease-in-out infinite` }}/>)}</div> : <div style={{ fontSize:16, fontWeight:700, color }}>{toVal}</div>}
        </div>
      )}
    </div>
  );
}

function NavScroll({ tabs, activeTab, onSelect }) {
  const scrollRef = useRef(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    // Force scroll styles directly on the DOM node
    el.style.overflowX = 'scroll';
    el.style.overflowY = 'hidden';
    el.style.webkitOverflowScrolling = 'touch';
    el.style.scrollbarWidth = 'none';
    el.style.msOverflowStyle = 'none';
    el.style.display = 'flex';
    el.style.flexDirection = 'row';
    el.style.flexWrap = 'nowrap';
    el.style.gap = '2px';
    el.style.padding = '10px 8px 20px';
    el.style.width = '100%';
    el.style.boxSizing = 'border-box';
  }, []);

  // Scroll active tab into view
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const activeBtn = el.querySelector(`[data-tabid="${activeTab}"]`);
    if (activeBtn) {
      activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }, [activeTab]);

  return (
    <>
      <style>{`
        .nav-scroll-inner::-webkit-scrollbar { display: none; }
      `}</style>
      <div
        ref={scrollRef}
        className="nav-scroll-inner"
      >
        {tabs.map(t => {
          const isActive = activeTab === t.id;
          return (
            <button
              key={t.id}
              data-tabid={t.id}
              onClick={() => onSelect(t.id)}
              style={{
                flexShrink: 0,
                flexGrow: 0,
                flexBasis: '64px',
                width: '64px',
                minWidth: '64px',
                maxWidth: '64px',
                height: '64px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '4px',
                padding: '8px 4px',
                borderRadius: '16px',
                background: isActive ? `${t.color}12` : 'transparent',
                border: isActive ? `1px solid ${t.color}25` : '1px solid transparent',
                cursor: 'pointer',
                position: 'relative',
                transition: 'all .2s',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
                outline: 'none',
                boxSizing: 'border-box',
              }}
            >
              {isActive && (
                <div style={{
                  position: 'absolute',
                  top: 4,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  width: 4,
                  height: 4,
                  borderRadius: '50%',
                  background: t.color,
                  boxShadow: `0 0 8px ${t.color}`,
                  pointerEvents: 'none',
                }} />
              )}
              <span style={{
                fontSize: 18,
                lineHeight: 1,
                color: isActive ? t.color : 'rgba(255,255,255,0.3)',
                filter: isActive ? `drop-shadow(0 0 6px ${t.color})` : 'none',
                transition: 'all .2s',
                pointerEvents: 'none',
                userSelect: 'none',
              }}>
                {t.icon}
              </span>
              <span style={{
                fontSize: 9,
                fontWeight: 600,
                whiteSpace: 'nowrap',
                color: isActive ? t.color : 'rgba(255,255,255,0.25)',
                letterSpacing: 0.3,
                transition: 'all .2s',
                pointerEvents: 'none',
                userSelect: 'none',
              }}>
                {t.label}
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function ActionBtn({ children, onClick, disabled, color='#00e5a0', variant='primary' }) {
  const ref = useRef(null);
  function handleClick(e) {
    if (disabled) return;
    const btn=ref.current; if(!btn) return;
    const r=btn.getBoundingClientRect();
    const ripple=document.createElement('span');
    const size=Math.max(r.width,r.height);
    ripple.style.cssText=`position:absolute;border-radius:50%;background:rgba(255,255,255,0.25);transform:scale(0);animation:ripple .55s linear;width:${size}px;height:${size}px;left:${e.clientX-r.left-size/2}px;top:${e.clientY-r.top-size/2}px;pointer-events:none`;
    btn.appendChild(ripple); setTimeout(()=>ripple.remove(),600);
    onClick?.(e);
  }
  const isDanger=variant==='danger';
  return (<button ref={ref} onClick={handleClick} disabled={disabled} style={{ width:'100%', padding:'17px', border:'none', borderRadius:18, fontFamily:"'Space Grotesk',sans-serif", fontSize:15, fontWeight:700, cursor:disabled?'not-allowed':'pointer', transition:'all .2s', position:'relative', overflow:'hidden', background:disabled?'rgba(255,255,255,0.05)':isDanger?'rgba(255,77,109,0.08)':`linear-gradient(135deg,${color},${color}cc)`, borderWidth:isDanger?1:0, borderStyle:'solid', borderColor:isDanger?'rgba(255,77,109,0.25)':'transparent', color:disabled?'rgba(255,255,255,0.2)':isDanger?'#ff4d6d':'#020e08', boxShadow:disabled||isDanger?'none':`0 4px 24px ${color}28` }}>{children}</button>);
}
function TokenSel({ tokens, selected, onSelect, loading, color='#00e5a0', onRefresh }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(()=>{ function h(e){ if(ref.current&&!ref.current.contains(e.target)) setOpen(false); } document.addEventListener('mousedown',h); return ()=>document.removeEventListener('mousedown',h); },[]);
  return (
    <div ref={ref} style={{ position:'relative' }}>
      <div style={{ display:'flex', gap:7 }}>
        <button onClick={()=>setOpen(o=>!o)} disabled={loading} style={{ flex:1, padding:'11px 14px', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:14, cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'space-between', transition:'all .2s' }}>
          {loading ? <span style={{ color:'rgba(255,255,255,0.3)', fontSize:12, fontFamily:"'JetBrains Mono',monospace" }}>Loading…</span>
            : selected
              ? <div style={{ display:'flex', alignItems:'center', gap:9 }}><div style={{ width:32, height:32, borderRadius:10, background:`${color}14`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:11, fontWeight:700, color, flexShrink:0 }}>{selected.symbol.slice(0,2)}</div><div><div style={{ fontSize:14, fontWeight:600, color:'#fff', textAlign:'left' }}>{selected.symbol}</div><div style={{ fontSize:9, color:'rgba(255,255,255,0.3)', fontFamily:"'JetBrains Mono',monospace", textAlign:'left' }}>{selected.hederaTokenId??selected.evmAddress.slice(0,14)+'…'}</div></div></div>
              : <span style={{ color:'rgba(255,255,255,0.25)', fontSize:12 }}>{tokens.length===0?'No tokens':'Select token'}</span>}
          <span style={{ color:'rgba(255,255,255,0.25)', fontSize:10, transform:open?'rotate(180deg)':'none', transition:'transform .2s' }}>▾</span>
        </button>
        <button onClick={onRefresh} style={{ padding:'0 13px', background:'rgba(255,255,255,0.03)', border:'1px solid rgba(255,255,255,0.08)', borderRadius:14, cursor:'pointer', color:'rgba(255,255,255,0.3)', fontSize:14 }}>↻</button>
      </div>
      {open&&(
        <div style={{ position:'absolute', top:'calc(100% + 6px)', left:0, right:0, zIndex:60, background:'#111620', border:'1px solid rgba(255,255,255,0.1)', borderRadius:18, overflow:'hidden', boxShadow:'0 20px 50px rgba(0,0,0,0.6)', animation:'fade-scale .18s ease' }}>
          {tokens.length===0 ? <div style={{ padding:20, textAlign:'center', color:'rgba(255,255,255,0.3)', fontSize:12 }}>No tokens. Create one first.</div>
            : tokens.map(t=>(<div key={t.evmAddress} onClick={()=>{ onSelect(t); setOpen(false); }} style={{ padding:'12px 16px', cursor:'pointer', display:'flex', alignItems:'center', gap:11, borderBottom:'1px solid rgba(255,255,255,0.04)', background:selected?.evmAddress===t.evmAddress?`${color}08`:'transparent', transition:'background .15s' }}><div style={{ width:36, height:36, borderRadius:11, background:`${color}14`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, color, flexShrink:0 }}>{t.symbol.slice(0,2)}</div><div style={{ flex:1, minWidth:0 }}><div style={{ fontSize:14, fontWeight:600, color:selected?.evmAddress===t.evmAddress?color:'#fff' }}>{t.symbol} <span style={{ fontWeight:400, color:'rgba(255,255,255,0.3)', fontSize:12 }}>{t.name}</span></div><div style={{ fontSize:9, color:'rgba(255,255,255,0.25)', fontFamily:"'JetBrains Mono',monospace", marginTop:1, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{t.hederaTokenId??t.evmAddress.slice(0,18)+'…'} · {t.decimals}d</div></div>{selected?.evmAddress===t.evmAddress&&<span style={{ color, fontSize:14 }}>✓</span>}</div>))}
        </div>
      )}
    </div>
  );
}