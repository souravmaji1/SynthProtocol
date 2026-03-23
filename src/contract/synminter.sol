


// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./HederaTokenService.sol";
import "./HederaResponseCodes.sol";

interface AggregatorV3Interface {
    function latestRoundData() external view returns (
        uint80 roundId,
        int256 answer,
        uint256 startedAt,
        uint256 updatedAt,
        uint80 answeredInRound
    );
}

contract SynthMinter is HederaTokenService {

    // ── Events ────────────────────────────────────────────────
    event SynthTokenCreated(address indexed tokenAddress, string name, string symbol, address indexed creator);
    event SynthMinted(address indexed to, address indexed tokenAddress, int64 synthMinted, uint256 hbarSent);
    event SynthBurned(address indexed from, address indexed tokenAddress, int64 synthBurned, uint256 hbarReturned);
    event FiatRateUpdated(address indexed tokenAddress, string symbol, uint256 unitsPerUsd);

    // ── Payment Rail Events ───────────────────────────────────
    event StreamStarted(address indexed streamer, address indexed recipient, address indexed tokenAddress, uint256 amountPerSecond, uint256 totalDeposited);
    event StreamClaimed(address indexed streamer, address indexed recipient, address indexed tokenAddress, uint256 amount);
    event StreamCancelled(address indexed streamer, address indexed tokenAddress, uint256 refunded);

    // ── Synth Token Registry ──────────────────────────────────
    struct SynthToken {
        address tokenAddress;
        string  name;
        string  symbol;
        uint8   decimals;
        uint256 fiatUnitsPerUsd;  // scaled by FIAT_PRECISION (1e6)
                                  // sINR=84_000_000, sUSD=1_000_000, sEUR=910_000
        int64   totalMinted;
        bool    isActive;
        address creator;
    }

    // ── Payment Stream Registry ───────────────────────────────
    struct Stream {
        address tokenAddress;        // which synth token is being streamed
        address recipient;
        uint256 amountPerSecond;     // in token's smallest units
        uint256 lastClaimTime;
        uint256 remainingDeposited;  // tokens held in this contract for the stream
    }

    mapping(address => SynthToken) public synthTokens;
    address[]                      public allSynthTokens;
    mapping(string => address)     public symbolToToken;

    // user → tokenAddress → HBAR deposited (tinybars)
    mapping(address => mapping(address => uint256)) public collateral;

    // streamer → tokenAddress → Stream
    // (one stream per streamer per token, allowing multi-token streams)
    mapping(address => mapping(address => Stream)) public streams;

    // ── Global config ─────────────────────────────────────────
    address public owner;
    AggregatorV3Interface public priceFeed;            // HBAR/USD Chainlink (8 decimals)
    uint256 public collateralRatio = 150;              // 150% over-collateralised
    uint256 public constant FIAT_PRECISION = 1e6;      // precision for fiatUnitsPerUsd

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    modifier onlyKnownToken(address tokenAddress) {
        require(synthTokens[tokenAddress].tokenAddress != address(0), "Synth: unknown token");
        _;
    }

    constructor(address _priceFeed) payable {
        owner     = msg.sender;
        priceFeed = AggregatorV3Interface(_priceFeed);
    }

    /* ══════════════════════════════════════════════════════════
       1. CREATE any synth token (permissionless)
          Send ~20 HBAR with the tx for HTS creation fee.

          fiatUnitsPerUsd examples (scaled by 1e6):
            sINR → 84_000_000
            sUSD →  1_000_000
            sEUR →    910_000
    ══════════════════════════════════════════════════════════ */
    function createSynthToken(
        string memory name,
        string memory symbol,
        string memory memo,
        uint8         decimals,
        int64         maxSupply,
        uint256       fiatUnitsPerUsd
    ) external payable returns (address tokenAddress) {

        require(bytes(name).length   > 0,                  "Empty name");
        require(bytes(symbol).length > 0,                  "Empty symbol");
        require(fiatUnitsPerUsd      > 0,                  "Bad fiat rate");
        require(symbolToToken[symbol] == address(0),       "Symbol already exists");

        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](2);
        // Supply key  (keyType = 1)
        keys[0] = IHederaTokenService.TokenKey(
            1,
            IHederaTokenService.KeyValue(false, address(this), bytes(""), bytes(""), address(0))
        );
        // Burn key (keyType = 16)
        keys[1] = IHederaTokenService.TokenKey(
            16,
            IHederaTokenService.KeyValue(false, address(this), bytes(""), bytes(""), address(0))
        );

        IHederaTokenService.HederaToken memory token;
        token.name            = name;
        token.symbol          = symbol;
        token.memo            = memo;
        token.treasury        = address(this);
        token.tokenSupplyType = maxSupply > 0;
        token.maxSupply       = maxSupply > 0 ? maxSupply : int64(0);
        token.freezeDefault   = false;
        token.tokenKeys       = keys;
        token.expiry          = IHederaTokenService.Expiry(0, address(this), 8000000);

        (int responseCode, address createdToken) =
            HederaTokenService.createFungibleToken(token, 0, int32(uint32(decimals)));

        require(responseCode == HederaResponseCodes.SUCCESS, "HTS: token creation failed");

        synthTokens[createdToken] = SynthToken({
            tokenAddress:    createdToken,
            name:            name,
            symbol:          symbol,
            decimals:        decimals,
            fiatUnitsPerUsd: fiatUnitsPerUsd,
            totalMinted:     0,
            isActive:        true,
            creator:         msg.sender
        });

        allSynthTokens.push(createdToken);
        symbolToToken[symbol] = createdToken;

        emit SynthTokenCreated(createdToken, name, symbol, msg.sender);
        return createdToken;
    }

    /* ══════════════════════════════════════════════════════════
       2. MINT — user sends HBAR + enters desired synth amount

       Formula (what synthAmount user should receive):
         hbarUSD   = (msg.value / 1e8) * (hbarPrice / 1e8)
         synthAmt  = hbarUSD * fiatUnitsPerUsd / FIAT_PRECISION
                     * 10^decimals
                     * 100 / collateralRatio

       Full integer form:
         synthAmt = msg.value * hbarPrice * fiatUnitsPerUsd * 10^decimals * 100
                    / (1e16 * FIAT_PRECISION * collateralRatio)
    ══════════════════════════════════════════════════════════ */
    function mintSynth(
        address tokenAddress,
        int64   synthAmount    // amount user EXPECTS to receive (used as slippage check)
    ) external payable onlyKnownToken(tokenAddress) {
        require(msg.value   > 0, "Send HBAR");
        require(synthAmount > 0, "Amount must be > 0");

        SynthToken storage st = synthTokens[tokenAddress];
        require(st.isActive, "Synth: inactive");

        // ── 1. Calculate how many synth tokens the sent HBAR buys ──
        int64 mintable = _synthAmountForHbar(st, msg.value);
        require(mintable > 0, "HBAR too small to mint any tokens");

        // ── 2. Slippage guard ──────────────────────────────────────
        require(mintable >= synthAmount, "Price moved: you'd receive less than requested");

        int64 toMint = mintable;

        // ── 3. Mint via HTS → treasury (this contract) ─────────────
        (int mintCode, , ) = HederaTokenService.mintToken(tokenAddress, toMint, new bytes[](0));
        require(mintCode == HederaResponseCodes.SUCCESS, "HTS: mint failed");

        st.totalMinted += toMint;

        // ── 4. Transfer treasury → user ────────────────────────────
        int xferCode = HederaTokenService.transferToken(tokenAddress, address(this), msg.sender, toMint);
        require(xferCode == HederaResponseCodes.SUCCESS, "HTS: transfer failed");

        // ── 5. Record collateral ───────────────────────────────────
        collateral[msg.sender][tokenAddress] += msg.value;

        emit SynthMinted(msg.sender, tokenAddress, toMint, msg.value);
    }

    /* ══════════════════════════════════════════════════════════
       3. BURN — return synth tokens, get HBAR back

       Inverse of mint:
         hbarBack = synthAmount * 1e16 * FIAT_PRECISION * collateralRatio
                    / (hbarPrice * fiatUnitsPerUsd * 10^decimals * 100)
    ══════════════════════════════════════════════════════════ */
    function burnSynth(address tokenAddress, int64 synthAmount) external onlyKnownToken(tokenAddress) {
        require(synthAmount > 0, "Amount must be > 0");

        SynthToken storage st = synthTokens[tokenAddress];

        // ── 1. Calculate HBAR to return ────────────────────────────
        uint256 hbarBack = _hbarForSynthAmount(st, uint64(synthAmount));

        // Cap to what user actually deposited for this token
        if (hbarBack > collateral[msg.sender][tokenAddress]) {
            hbarBack = collateral[msg.sender][tokenAddress];
        }
        require(hbarBack > 0, "Nothing to return");

        // ── 2. Pull tokens from user → treasury ────────────────────
        int xferCode = HederaTokenService.transferToken(tokenAddress, msg.sender, address(this), synthAmount);
        require(xferCode == HederaResponseCodes.SUCCESS, "HTS: pull to treasury failed");

        // ── 3. Burn from treasury ───────────────────────────────────
        (int burnCode, ) = HederaTokenService.burnToken(tokenAddress, synthAmount, new int64[](0));
        require(burnCode == HederaResponseCodes.SUCCESS, "HTS: burn failed");

        st.totalMinted -= synthAmount;

        // ── 4. Deduct collateral and send HBAR back ─────────────────
        collateral[msg.sender][tokenAddress] -= hbarBack;

        (bool ok, ) = payable(msg.sender).call{value: hbarBack}("");
        require(ok, "HBAR return failed");

        emit SynthBurned(msg.sender, tokenAddress, synthAmount, hbarBack);
    }

    /* ══════════════════════════════════════════════════════════
       4. PAYMENT RAIL — Start a token stream

       The caller deposits synth tokens into this contract and
       designates a recipient + rate. One active stream per
       (streamer, tokenAddress) pair is allowed.

       The caller must hold at least `totalAmount` of the synth
       token. This contract (treasury) transfers from caller.
    ══════════════════════════════════════════════════════════ */
    function startStream(
        address tokenAddress,
        address recipient,
        uint256 amountPerSecond,
        uint256 totalAmount
    ) external onlyKnownToken(tokenAddress) {
        require(streams[msg.sender][tokenAddress].recipient == address(0), "Stream already active for this token");
        require(recipient      != address(0), "Invalid recipient");
        require(amountPerSecond > 0,          "Rate must be > 0");
        require(totalAmount    >= amountPerSecond, "Deposit too small");


        streams[msg.sender][tokenAddress] = Stream({
            tokenAddress:       tokenAddress,
            recipient:          recipient,
            amountPerSecond:    amountPerSecond,
            lastClaimTime:      block.timestamp,
            remainingDeposited: totalAmount
        });

        emit StreamStarted(msg.sender, recipient, tokenAddress, amountPerSecond, totalAmount);
    }

    // Add this function to SynthMinter.sol
function startStreamWithDeposit(
    address tokenAddress,
    address recipient,
    uint256 amountPerSecond,
    uint256 totalAmount
) external onlyKnownToken(tokenAddress) {
    require(streams[msg.sender][tokenAddress].recipient == address(0), "Stream already active");
    require(recipient != address(0), "Invalid recipient");
    require(amountPerSecond > 0, "Rate must be > 0");
    require(totalAmount >= amountPerSecond, "Deposit too small");

    // 1. Pull tokens from streamer → this contract (atomic)
    int xferCode = HederaTokenService.transferToken(
        tokenAddress,
        msg.sender,        // from: streamer
        address(this),     // to: treasury
        int64(uint64(totalAmount))
    );
    require(xferCode == HederaResponseCodes.SUCCESS, "HTS: deposit failed");

    // 2. Record the stream
    streams[msg.sender][tokenAddress] = Stream({
        tokenAddress: tokenAddress,
        recipient: recipient,
        amountPerSecond: amountPerSecond,
        lastClaimTime: block.timestamp,
        remainingDeposited: totalAmount
    });

    emit StreamStarted(msg.sender, recipient, tokenAddress, amountPerSecond, totalAmount);
}


    /* ══════════════════════════════════════════════════════════
       5. PAYMENT RAIL — Claim accrued tokens (pull-based)

       Anyone can call — the tokens always go to the stream's
       designated recipient. Partial claims are supported; the
       stream continues until the deposit is exhausted.
    ══════════════════════════════════════════════════════════ */
    function claimStream(address streamer, address tokenAddress) external onlyKnownToken(tokenAddress) {
        Stream storage s = streams[streamer][tokenAddress];
        require(s.recipient != address(0), "No stream exists");

        uint256 timePassed  = block.timestamp - s.lastClaimTime;
        uint256 accrued     = timePassed * s.amountPerSecond;
        uint256 claimAmount = accrued > s.remainingDeposited
                                ? s.remainingDeposited
                                : accrued;
        require(claimAmount > 0, "Nothing to claim");

        // Transfer from this contract (treasury) → recipient
        int xferCode = HederaTokenService.transferToken(
            tokenAddress,
            address(this),
            s.recipient,
            int64(uint64(claimAmount))
        );
        require(xferCode == HederaResponseCodes.SUCCESS, "HTS: claim transfer failed");

        s.lastClaimTime      = block.timestamp;
        s.remainingDeposited -= claimAmount;

        emit StreamClaimed(streamer, s.recipient, tokenAddress, claimAmount);
    }

    /* ══════════════════════════════════════════════════════════
       6. PAYMENT RAIL — Cancel stream and refund streamer
    ══════════════════════════════════════════════════════════ */
    function cancelStream(address tokenAddress) external onlyKnownToken(tokenAddress) {
        Stream storage s = streams[msg.sender][tokenAddress];
        require(s.recipient != address(0), "No stream");

        uint256 leftover = s.remainingDeposited;

        if (leftover > 0) {
            int xferCode = HederaTokenService.transferToken(
                tokenAddress,
                address(this),
                msg.sender,
                int64(uint64(leftover))
            );
            require(xferCode == HederaResponseCodes.SUCCESS, "HTS: refund failed");
        }

        emit StreamCancelled(msg.sender, tokenAddress, leftover);
        delete streams[msg.sender][tokenAddress];
    }

    /* ══════════════════════════════════════════════════════════
       VIEW — Mint / Burn previews
    ══════════════════════════════════════════════════════════ */
    function previewMint(address tokenAddress, uint256 hbarTinybars)
        external view returns (int64 synthAmount)
    {
        SynthToken storage st = synthTokens[tokenAddress];
        require(st.tokenAddress != address(0), "Unknown token");
        return _synthAmountForHbar(st, hbarTinybars);
    }

    function previewBurn(address tokenAddress, uint64 synthAmount)
        external view returns (uint256 hbarTinybars)
    {
        SynthToken storage st = synthTokens[tokenAddress];
        require(st.tokenAddress != address(0), "Unknown token");
        return _hbarForSynthAmount(st, synthAmount);
    }

    /* ══════════════════════════════════════════════════════════
       VIEW — Stream helpers
    ══════════════════════════════════════════════════════════ */

    /// @notice How many tokens are currently claimable for a stream
    function getClaimable(address streamer, address tokenAddress) external view returns (uint256) {
        Stream storage s = streams[streamer][tokenAddress];
        if (s.recipient == address(0)) return 0;
        uint256 accrued = (block.timestamp - s.lastClaimTime) * s.amountPerSecond;
        return accrued > s.remainingDeposited ? s.remainingDeposited : accrued;
    }

    /// @notice Remaining deposited tokens in a stream
    function getStreamRemaining(address streamer, address tokenAddress) external view returns (uint256) {
        return streams[streamer][tokenAddress].remainingDeposited;
    }

    /// @notice Full stream details
    function getStream(address streamer, address tokenAddress) external view returns (Stream memory) {
        return streams[streamer][tokenAddress];
    }

    /* ══════════════════════════════════════════════════════════
       VIEW — Token / price helpers
    ══════════════════════════════════════════════════════════ */

    /// @notice Latest HBAR/USD price (8 decimals)
    function getHBARPrice() public view returns (uint256) {
        (, int256 price, , , ) = priceFeed.latestRoundData();
        require(price > 0, "Bad price feed");
        return uint256(price);
    }

    function getAllSynthTokens() external view returns (address[] memory) {
        return allSynthTokens;
    }

    function getSynthToken(address tokenAddress) external view returns (SynthToken memory) {
        return synthTokens[tokenAddress];
    }

    function getTokenBySymbol(string memory symbol) external view returns (address) {
        return symbolToToken[symbol];
    }

    function getUserCollateral(address user, address tokenAddress) external view returns (uint256) {
        return collateral[user][tokenAddress];
    }

    /* ══════════════════════════════════════════════════════════
       ADMIN
    ══════════════════════════════════════════════════════════ */

    function updateFiatRate(address tokenAddress, uint256 newFiatUnitsPerUsd) external onlyOwner {
        require(newFiatUnitsPerUsd > 0, "Bad rate");
        SynthToken storage st = synthTokens[tokenAddress];
        require(st.tokenAddress != address(0), "Unknown token");
        st.fiatUnitsPerUsd = newFiatUnitsPerUsd;
        emit FiatRateUpdated(tokenAddress, st.symbol, newFiatUnitsPerUsd);
    }

    function toggleSynthToken(address tokenAddress) external {
        SynthToken storage st = synthTokens[tokenAddress];
        require(st.tokenAddress != address(0), "Unknown token");
        require(msg.sender == owner || msg.sender == st.creator, "Not owner or creator");
        st.isActive = !st.isActive;
    }

    function setPriceFeed(address newFeed) external onlyOwner {
        require(newFeed != address(0), "Zero address");
        priceFeed = AggregatorV3Interface(newFeed);
    }

    function setCollateralRatio(uint256 ratio) external onlyOwner {
        require(ratio >= 100, "Must be >= 100");
        collateralRatio = ratio;
    }

    function withdraw(uint256 amount) external onlyOwner {
        (bool ok, ) = payable(owner).call{value: amount}("");
        require(ok, "Withdraw failed");
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    receive() external payable {}

    /* ══════════════════════════════════════════════════════════
       INTERNAL MATH

       MINT direction  (HBAR → synth):
         synthAmt = tinybars * hbarPrice * fiatUnitsPerUsd * 10^decimals * 100
                    / (1e16 * FIAT_PRECISION * collateralRatio)

       BURN direction  (synth → HBAR):
         tinybars = synthAmt * 1e16 * FIAT_PRECISION * collateralRatio
                    / (hbarPrice * fiatUnitsPerUsd * 10^decimals * 100)
    ══════════════════════════════════════════════════════════ */
    function _synthAmountForHbar(SynthToken storage st, uint256 tinybars)
        internal view returns (int64)
    {
        uint256 hbarPrice  = getHBARPrice();
        uint256 decimalMul = 10 ** uint256(st.decimals);

        uint256 numerator   = tinybars
                                * hbarPrice
                                * st.fiatUnitsPerUsd
                                * decimalMul
                                * 100;

        uint256 denominator = 1e16
                                * FIAT_PRECISION
                                * collateralRatio;

        return int64(uint64(numerator / denominator));
    }

    function _hbarForSynthAmount(SynthToken storage st, uint64 synthAmt)
        internal view returns (uint256)
    {
        uint256 hbarPrice  = getHBARPrice();
        uint256 decimalDiv = 10 ** uint256(st.decimals);

        uint256 numerator   = uint256(synthAmt)
                                * 1e16
                                * FIAT_PRECISION
                                * collateralRatio;

        uint256 denominator = hbarPrice
                                * st.fiatUnitsPerUsd
                                * decimalDiv
                                * 100;

        return numerator / denominator;
    }
}


