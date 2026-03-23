

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
import "./HederaTokenService.sol";
import "./HederaResponseCodes.sol";

contract SauceStaking is HederaTokenService {
    // ── Events ────────────────────────────────────────────────────────────
    event Staked(address indexed user, uint256 indexed positionId, StakeType stakeType, uint256 amount, Tier tier, uint256 unlockTime);
    event Unstaked(address indexed user, uint256 indexed positionId, uint256 principalReturned, uint256 sauceRewarded, bool earlyExit);
    event RewardClaimed(address indexed user, uint256 indexed positionId, uint256 sauceAmount);
    event SauceTokenSet(address indexed sauceToken);
    event WhbarTokenSet(address indexed whbarToken);
    event AprUpdated(Tier tier, uint256 newApr);
    event PenaltyTreasuryUpdated(address indexed treasury);
    event EmergencyWithdraw(address indexed owner, uint256 hbarAmount);
    event SauceFunded(address indexed funder, uint256 amount);
    event ProductListed(address indexed seller, uint256 indexed productId, string name, address paymentToken, uint256 price);
    event ProductUpdated(uint256 indexed productId, address paymentToken, uint256 price, bool active);
    event ProductPurchased(address indexed buyer, address indexed seller, uint256 indexed productId, uint256 purchaseId, uint256 price);

    // ── Types ─────────────────────────────────────────────────────────────
    enum StakeType { HBAR, WHBAR }
    enum Tier { FLEX, T30, T90, T180 }

    struct StakePosition {
        uint256 positionId;
        StakeType stakeType;
        Tier tier;
        uint256 amount;
        uint256 stakedAt;
        uint256 unlockTime;
        uint256 lastClaimTime;
        bool active;
    }

    struct Product {
        uint256 productId;
        address seller;
        string name;
        string description;
        address paymentToken;
        uint256 price;
        bool active;
        uint256 createdAt;
    }

    struct Purchase {
        uint256 purchaseId;
        uint256 productId;
        address buyer;
        address seller;
        address paymentToken;
        uint256 pricePaid;
        uint256 purchasedAt;
    }

    // ── Storage ───────────────────────────────────────────────────────────
    address public owner;
    address public sauceToken;
    address public whbarToken;
    address public penaltyTreasury;

    mapping(Tier => uint256) public aprBps;
    mapping(Tier => uint256) public lockSeconds;
    mapping(address => StakePosition[]) public positions;

    uint256 public nextPositionId;
    uint256 public totalHbarStaked;
    uint256 public totalWhbarStaked;
    uint256 public sauceRewardPool;

    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant PENALTY_BPS = 1_000;
    uint256 public constant SECONDS_PER_MINUTE = 60;
    uint8  public sauceDecimals;

    // ── Marketplace Storage ───────────────────────────────────────────────
    mapping(uint256 => Product)  public products;
    uint256 public nextProductId;
    mapping(address => uint256[]) private sellerProducts;
    mapping(uint256 => Purchase) public purchases;
    uint256 public nextPurchaseId;
    mapping(address => uint256[]) private buyerPurchases;
    mapping(uint256 => uint256[]) private productPurchases;

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────
    constructor(address _whbarToken, address _penaltyTreasury) payable {
        owner = msg.sender;
        whbarToken = _whbarToken;
        penaltyTreasury = _penaltyTreasury;

        aprBps[Tier.FLEX]  = 0;
        aprBps[Tier.T30]   = 200;   // 2% per minute
        aprBps[Tier.T90]   = 1_200; // 12% APY
        aprBps[Tier.T180]  = 2_000; // 20% APY

        lockSeconds[Tier.FLEX] = 0;
        lockSeconds[Tier.T30]  = 30 minutes;
        lockSeconds[Tier.T90]  = 90 days;
        lockSeconds[Tier.T180] = 180 days;

        emit WhbarTokenSet(_whbarToken);
    }

    /* ══════════════════════════════════════════════════════════════════════
       FUND SAUCE REWARD POOL
       Tokens are sent directly to this contract via a TransferTransaction
       before calling this function. This function only credits the counter.
    ══════════════════════════════════════════════════════════════════════ */
    function fundSauceRewards(uint256 amount) external onlyOwner {
        require(sauceToken != address(0), "SAUCE token not set");
        require(amount > 0, "Amount must be > 0");
        // Tokens already transferred directly to this contract address.
        // Just increment the pool counter so the contract tracks available rewards.
        sauceRewardPool += amount;
        emit SauceFunded(msg.sender, amount);
    }

    /* ══════════════════════════════════════════════════════════════════════
       1. STAKE
    ══════════════════════════════════════════════════════════════════════ */
    function stake(StakeType stakeType, uint256 amount, Tier tier) external payable {
        require(sauceToken != address(0), "SAUCE token not set");
        uint256 stakeAmount;
        if (stakeType == StakeType.HBAR) {
            require(msg.value > 0, "Send HBAR");
            stakeAmount = msg.value;
            totalHbarStaked += stakeAmount;
        } else {
            require(whbarToken != address(0), "WHBAR not set");
            require(amount > 0, "Amount must be > 0");
            require(msg.value == 0, "Do not send HBAR for WHBAR stake");
            stakeAmount = amount;
            int xferCode = HederaTokenService.transferToken(
                whbarToken, msg.sender, address(this), int64(uint64(stakeAmount))
            );
            require(xferCode == HederaResponseCodes.SUCCESS, "HTS: WHBAR transfer failed");
            totalWhbarStaked += stakeAmount;
        }

        uint256 unlock = block.timestamp + lockSeconds[tier];
        uint256 pid    = nextPositionId++;

        positions[msg.sender].push(StakePosition({
            positionId:    pid,
            stakeType:     stakeType,
            tier:          tier,
            amount:        stakeAmount,
            stakedAt:      block.timestamp,
            unlockTime:    unlock,
            lastClaimTime: block.timestamp,
            active:        true
        }));

        emit Staked(msg.sender, pid, stakeType, stakeAmount, tier, unlock);
    }

    /* ══════════════════════════════════════════════════════════════════════
       2. UNSTAKE
    ══════════════════════════════════════════════════════════════════════ */
    function unstake(uint256 positionIndex) external {
        StakePosition storage pos = _getActivePosition(msg.sender, positionIndex);
        bool earlyExit = (pos.tier != Tier.FLEX) && (block.timestamp < pos.unlockTime);

        uint256 principal = pos.amount;
        uint256 reward    = 0;

        if (earlyExit) {
            uint256 penalty = (principal * PENALTY_BPS) / BPS_DENOMINATOR;
            principal -= penalty;
            _returnStake(pos.stakeType, penaltyTreasury, penalty);
        } else {
            reward = _calculateReward(pos);
        }

        pos.active = false;
        if (pos.stakeType == StakeType.HBAR) totalHbarStaked  -= pos.amount;
        else                                  totalWhbarStaked -= pos.amount;

        _returnStake(pos.stakeType, msg.sender, principal);
        if (reward > 0) _distributeSauce(msg.sender, reward);

        emit Unstaked(msg.sender, pos.positionId, principal, reward, earlyExit);
    }

    /* ══════════════════════════════════════════════════════════════════════
       3. CLAIM REWARD (FLEX only)
    ══════════════════════════════════════════════════════════════════════ */
    function claimReward(uint256 positionIndex) external {
        StakePosition storage pos = _getActivePosition(msg.sender, positionIndex);
        require(pos.tier == Tier.FLEX, "Claim mid-lock only for FLEX");
        uint256 reward = _calculateReward(pos);
        require(reward > 0, "Nothing to claim");
        pos.lastClaimTime = block.timestamp;
        _distributeSauce(msg.sender, reward);
        emit RewardClaimed(msg.sender, pos.positionId, reward);
    }

    /* ══════════════════════════════════════════════════════════════════════
       4. MARKETPLACE — LIST PRODUCT
    ══════════════════════════════════════════════════════════════════════ */
    function listProduct(
        string calldata name,
        string calldata description,
        address paymentToken,
        uint256 price
    ) external returns (uint256 productId) {
        require(bytes(name).length > 0, "Name required");
        require(paymentToken != address(0), "Invalid payment token");
        require(price > 0, "Price must be > 0");

        productId = nextProductId++;
        products[productId] = Product({
            productId:    productId,
            seller:       msg.sender,
            name:         name,
            description:  description,
            paymentToken: paymentToken,
            price:        price,
            active:       true,
            createdAt:    block.timestamp
        });
        sellerProducts[msg.sender].push(productId);
        emit ProductListed(msg.sender, productId, name, paymentToken, price);
    }

    /* ══════════════════════════════════════════════════════════════════════
       5. MARKETPLACE — UPDATE PRODUCT
    ══════════════════════════════════════════════════════════════════════ */
    function updateProduct(uint256 productId, address newPaymentToken, uint256 newPrice, bool active) external {
        Product storage p = products[productId];
        require(p.seller == msg.sender, "Not your product");
        require(newPaymentToken != address(0), "Invalid payment token");
        require(newPrice > 0, "Price must be > 0");
        p.paymentToken = newPaymentToken;
        p.price        = newPrice;
        p.active       = active;
        emit ProductUpdated(productId, newPaymentToken, newPrice, active);
    }

    /* ══════════════════════════════════════════════════════════════════════
       6. MARKETPLACE — BUY PRODUCT
    ══════════════════════════════════════════════════════════════════════ */
    function buyProduct(uint256 productId) external returns (uint256 purchaseId) {
        Product storage p = products[productId];
        require(p.active, "Product not active");
        require(p.seller != msg.sender, "Cannot buy your own product");

        int xferCode = HederaTokenService.transferToken(
            p.paymentToken, msg.sender, p.seller, int64(uint64(p.price))
        );
        require(xferCode == HederaResponseCodes.SUCCESS, "HTS: payment failed");

        purchaseId = nextPurchaseId++;
        purchases[purchaseId] = Purchase({
            purchaseId:   purchaseId,
            productId:    productId,
            buyer:        msg.sender,
            seller:       p.seller,
            paymentToken: p.paymentToken,
            pricePaid:    p.price,
            purchasedAt:  block.timestamp
        });
        buyerPurchases[msg.sender].push(purchaseId);
        productPurchases[productId].push(purchaseId);
        emit ProductPurchased(msg.sender, p.seller, productId, purchaseId, p.price);
    }

    /* ══════════════════════════════════════════════════════════════════════
       MARKETPLACE READ FUNCTIONS
    ══════════════════════════════════════════════════════════════════════ */
    function getProduct(uint256 productId) external view returns (Product memory) {
        require(productId < nextProductId, "Product does not exist");
        return products[productId];
    }

    function getProductsBySeller(address seller) external view returns (Product[] memory result) {
        uint256[] storage ids = sellerProducts[seller];
        result = new Product[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) result[i] = products[ids[i]];
    }

    function getActiveProducts(uint256 offset, uint256 limit)
        external view returns (Product[] memory result, uint256 total)
    {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < nextProductId; i++) if (products[i].active) activeCount++;
        total = activeCount;
        if (offset >= activeCount || limit == 0) { result = new Product[](0); return (result, total); }
        uint256 end = offset + limit > activeCount ? activeCount : offset + limit;
        result = new Product[](end - offset);
        uint256 idx = 0; uint256 cursor = 0;
        for (uint256 i = 0; i < nextProductId && idx < result.length; i++) {
            if (products[i].active) {
                if (cursor >= offset) result[idx++] = products[i];
                cursor++;
            }
        }
    }

    function getPurchasesByBuyer(address buyer) external view returns (Purchase[] memory result) {
        uint256[] storage ids = buyerPurchases[buyer];
        result = new Purchase[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) result[i] = purchases[ids[i]];
    }

    function getPurchasesByProduct(uint256 productId) external view returns (Purchase[] memory result) {
        require(productId < nextProductId, "Product does not exist");
        uint256[] storage ids = productPurchases[productId];
        result = new Purchase[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) result[i] = purchases[ids[i]];
    }

    function getPurchase(uint256 purchaseId) external view returns (Purchase memory) {
        require(purchaseId < nextPurchaseId, "Purchase does not exist");
        return purchases[purchaseId];
    }

    function hasPurchased(address buyer, uint256 productId) external view returns (bool) {
        uint256[] storage ids = buyerPurchases[buyer];
        for (uint256 i = 0; i < ids.length; i++)
            if (purchases[ids[i]].productId == productId) return true;
        return false;
    }

    /* ══════════════════════════════════════════════════════════════════════
       STAKING VIEW HELPERS
    ══════════════════════════════════════════════════════════════════════ */
    function getPositions(address user) external view returns (StakePosition[] memory) {
        return positions[user];
    }

    function getPosition(address user, uint256 index) external view returns (StakePosition memory) {
        require(index < positions[user].length, "Out of range");
        return positions[user][index];
    }

    function previewReward(address user, uint256 positionIndex) external view returns (uint256) {
        require(positionIndex < positions[user].length, "Out of range");
        StakePosition storage pos = positions[user][positionIndex];
        if (!pos.active) return 0;
        return _calculateReward(pos);
    }

    function positionCount(address user) external view returns (uint256) {
        return positions[user].length;
    }

    function timeToUnlock(address user, uint256 positionIndex) external view returns (uint256) {
        require(positionIndex < positions[user].length, "Out of range");
        StakePosition storage pos = positions[user][positionIndex];
        if (block.timestamp >= pos.unlockTime) return 0;
        return pos.unlockTime - block.timestamp;
    }

    /* ══════════════════════════════════════════════════════════════════════
       ADMIN
    ══════════════════════════════════════════════════════════════════════ */
    function setSauceToken(address _sauceToken, uint8 _decimals) external onlyOwner {
        require(_sauceToken != address(0), "Zero address");
        sauceToken     = _sauceToken;
        sauceDecimals  = _decimals;

        // Self-associate so this contract can hold SAUCE balance
        int assocCode = HederaTokenService.associateToken(address(this), _sauceToken);
        require(
            assocCode == HederaResponseCodes.SUCCESS ||
            assocCode == HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT,
            "HTS: SAUCE association failed"
        );

        emit SauceTokenSet(_sauceToken);
    }

    function setWhbarToken(address _whbarToken) external onlyOwner {
        require(_whbarToken != address(0), "Zero address");
        whbarToken = _whbarToken;
        emit WhbarTokenSet(_whbarToken);
    }

    function setPenaltyTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0), "Zero address");
        penaltyTreasury = _treasury;
        emit PenaltyTreasuryUpdated(_treasury);
    }

    function setApr(Tier tier, uint256 bps) external onlyOwner {
        require(bps <= 100_000, "APR too high");
        aprBps[tier] = bps;
        emit AprUpdated(tier, bps);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Zero address");
        owner = newOwner;
    }

    function emergencyWithdrawHbar(uint256 amount) external onlyOwner {
        require(amount <= address(this).balance - totalHbarStaked, "Cannot touch staked HBAR");
        (bool ok, ) = payable(owner).call{value: amount}("");
        require(ok, "Withdraw failed");
        emit EmergencyWithdraw(owner, amount);
    }

    function withdrawSauceRewards(uint256 amount) external onlyOwner {
        require(amount <= sauceRewardPool, "Exceeds pool");
        sauceRewardPool -= amount;
        int xferCode = HederaTokenService.transferToken(
            sauceToken, address(this), msg.sender, int64(uint64(amount))
        );
        require(xferCode == HederaResponseCodes.SUCCESS, "HTS: withdraw failed");
    }

    receive() external payable {}

    /* ══════════════════════════════════════════════════════════════════════
       INTERNAL
    ══════════════════════════════════════════════════════════════════════ */
    function _calculateReward(StakePosition storage pos) internal view returns (uint256) {
        if (aprBps[pos.tier] == 0) return 0;
        uint256 rawReward;
        if (pos.tier == Tier.T30) {
            uint256 endTime      = block.timestamp < pos.unlockTime ? block.timestamp : pos.unlockTime;
            uint256 elapsed      = endTime - pos.lastClaimTime;
            uint256 elapsedMins  = elapsed / SECONDS_PER_MINUTE;
            if (elapsedMins == 0) return 0;
            rawReward = (pos.amount * aprBps[Tier.T30] * elapsedMins) / BPS_DENOMINATOR;
        } else {
            uint256 endTime = (pos.tier == Tier.FLEX)
                ? block.timestamp
                : (block.timestamp < pos.unlockTime ? block.timestamp : pos.unlockTime);
            uint256 elapsed = endTime - pos.lastClaimTime;
            if (elapsed == 0) return 0;
            rawReward = (pos.amount * aprBps[pos.tier] * elapsed) / (BPS_DENOMINATOR * SECONDS_PER_YEAR);
        }
        if (sauceDecimals > 8)      rawReward = rawReward * (10 ** uint256(sauceDecimals - 8));
        else if (sauceDecimals < 8) rawReward = rawReward / (10 ** uint256(8 - sauceDecimals));
        return rawReward;
    }

    function _distributeSauce(address to, uint256 amount) internal {
        require(sauceRewardPool >= amount, "Insufficient SAUCE in reward pool");
        sauceRewardPool -= amount;
        int xferCode = HederaTokenService.transferToken(
            sauceToken, address(this), to, int64(uint64(amount))
        );
        require(xferCode == HederaResponseCodes.SUCCESS, "HTS: SAUCE transfer failed");
    }

    function _returnStake(StakeType stakeType, address to, uint256 amount) internal {
        if (amount == 0) return;
        if (stakeType == StakeType.HBAR) {
            (bool ok, ) = payable(to).call{value: amount}("");
            require(ok, "HBAR return failed");
        } else {
            int xferCode = HederaTokenService.transferToken(
                whbarToken, address(this), to, int64(uint64(amount))
            );
            require(xferCode == HederaResponseCodes.SUCCESS, "HTS: WHBAR return failed");
        }
    }

    function _getActivePosition(address user, uint256 index)
        internal view returns (StakePosition storage)
    {
        require(index < positions[user].length, "Out of range");
        StakePosition storage pos = positions[user][index];
        require(pos.active, "Position already closed");
        return pos;
    }
}