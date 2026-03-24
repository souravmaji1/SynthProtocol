
---

**SynthProtocol — Synthetic Assets & DeFi Infrastructure on Hedera**

SynthProtocol is a full-stack decentralized finance platform built on Hedera Testnet that enables users to create, mint, and burn fiat-pegged synthetic tokens backed by HBAR collateral, stream payments in real time, and earn SAUCE token rewards through a native staking system — all within a single, mobile-friendly interface.

**What it does:**

At its core, SynthProtocol lets anyone permissionlessly deploy HTS-native synthetic tokens (sUSD, sEUR, sINR, sGBP, and more) pegged to real-world fiat currencies. Each token is over-collateralized at 150% using HBAR, with live pricing sourced from a Chainlink oracle. Users mint synths by depositing HBAR and burn them to reclaim collateral — previewing exact amounts before every transaction.

On top of that, the platform includes a real-time payment streaming engine: users can stream any synth token to any address at a per-second rate, cancel anytime for an instant refund, and recipients can claim accrued tokens on demand.

To incentivize liquidity, every mint operation automatically stakes the user's HBAR into a tiered SAUCE reward system — with flexible, 30-day, 90-day, and 180-day lock options offering up to 20% APY paid in SAUCE tokens. Early exits are allowed with a 10% penalty.

Finally, SynthProtocol includes an on-chain marketplace where users can list and purchase digital products priced in any synth token, creating a closed-loop economy entirely denominated in synthetic assets.

**Tech stack:** Hedera Token Service (HTS), Solidity smart contracts, Hashgraph React Wallets, HashPack wallet, Chainlink price feeds, Hedera Mirror Node, and ethers.js.
