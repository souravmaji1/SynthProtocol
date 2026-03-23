// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./HederaTokenService.sol";
import "./HederaResponseCodes.sol";

contract FungibleTokenFactory is HederaTokenService {

    event TokenCreated(address indexed token, address indexed creator, string name, string symbol, uint8 decimals);
    event TokensMinted(address indexed token, address indexed minter, address indexed recipient, int64 amount);
    event TokensBurned(address indexed token, address indexed burner, int64 amount);

    event BridgeInitiated(
        address indexed sender,
        address indexed tokenAddress,
        string          tokenName,
        string          tokenSymbol,
        uint8           decimals,
        int64           amount,
        address         receiverOnSepolia,
        uint256         timestamp
    );

    event TokensReturned(
        address indexed receiver,
        address indexed tokenAddress,
        int64           amount,
        uint256         timestamp
    );

    // ── Whitelist events ──────────────────────────────────────
    event TokenWhitelisted(address indexed tokenAddress, string name, string symbol, uint8 decimals);
    event TokenRemovedFromWhitelist(address indexed tokenAddress);

    // ── Manager events ────────────────────────────────────────
    event ManagerAdded(address indexed manager, address indexed addedBy);
    event ManagerRemoved(address indexed manager, address indexed removedBy);

    struct TokenInfo {
        address tokenAddress;
        address creator;
        string name;
        string symbol;
        uint8 decimals;
        int64 totalMinted;
        int64 maxSupply;
        bool isActive;
    }

    // ── Whitelist state ────────────────────────────────────────
    struct BridgeableToken {
        address tokenAddress;
        string  name;
        string  symbol;
        uint8   decimals;
        bool    isActive;
    }

    mapping(address => BridgeableToken) private _bridgeableTokens;
    address[] private _bridgeableTokenList;

    mapping(address => TokenInfo) public tokens;
    address[] public allTokens;
    address public owner;

    // ── Manager state ─────────────────────────────────────────
    mapping(address => bool) public isManager;
    address[] private _managerList;

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner can call this");
        _;
    }

    modifier onlyOwnerOrManager() {
        require(msg.sender == owner || isManager[msg.sender], "Only owner or manager can call this");
        _;
    }

    /* ----------------------------------------------------------
       MANAGER: Add a manager (owner only)
    ---------------------------------------------------------- */
    function addManager(address manager) external onlyOwner {
        require(manager != address(0), "Manager: zero address");
        require(!isManager[manager], "Manager: already a manager");
        require(manager != owner, "Manager: owner cannot be a manager");
        isManager[manager] = true;
        _managerList.push(manager);
        emit ManagerAdded(manager, msg.sender);
    }

    /* ----------------------------------------------------------
       MANAGER: Remove a manager (owner only)
    ---------------------------------------------------------- */
    function removeManager(address manager) external onlyOwner {
        require(isManager[manager], "Manager: not a manager");
        isManager[manager] = false;
        // Remove from list
        for (uint256 i = 0; i < _managerList.length; i++) {
            if (_managerList[i] == manager) {
                _managerList[i] = _managerList[_managerList.length - 1];
                _managerList.pop();
                break;
            }
        }
        emit ManagerRemoved(manager, msg.sender);
    }

    /* ----------------------------------------------------------
       VIEW: Get all active managers
    ---------------------------------------------------------- */
    function getManagers() external view returns (address[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < _managerList.length; i++) {
            if (isManager[_managerList[i]]) activeCount++;
        }
        address[] memory result = new address[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < _managerList.length; i++) {
            if (isManager[_managerList[i]]) {
                result[idx++] = _managerList[i];
            }
        }
        return result;
    }

    /* ----------------------------------------------------------
       ADMIN: Whitelist a token for bridging (owner or manager)
    ---------------------------------------------------------- */
    function addBridgeableToken(
        address tokenAddress,
        string memory tokenName,
        string memory tokenSymbol,
        uint8         tokenDecimals
    ) external onlyOwnerOrManager {
        require(tokenAddress != address(0), "Bridge: zero token");
        if (_bridgeableTokens[tokenAddress].tokenAddress == address(0)) {
            _bridgeableTokenList.push(tokenAddress);
        }
        _bridgeableTokens[tokenAddress] = BridgeableToken({
            tokenAddress: tokenAddress,
            name:         tokenName,
            symbol:       tokenSymbol,
            decimals:     tokenDecimals,
            isActive:     true
        });
        emit TokenWhitelisted(tokenAddress, tokenName, tokenSymbol, tokenDecimals);
    }

    /* ----------------------------------------------------------
       ADMIN: Remove a token from whitelist (owner or manager)
    ---------------------------------------------------------- */
    function removeBridgeableToken(address tokenAddress) external onlyOwnerOrManager {
        require(_bridgeableTokens[tokenAddress].tokenAddress != address(0), "Bridge: not listed");
        _bridgeableTokens[tokenAddress].isActive = false;
        emit TokenRemovedFromWhitelist(tokenAddress);
    }

    /* ----------------------------------------------------------
       VIEW: Get all active bridgeable tokens
    ---------------------------------------------------------- */
    function getBridgeableTokens() external view returns (BridgeableToken[] memory) {
        uint256 activeCount = 0;
        for (uint256 i = 0; i < _bridgeableTokenList.length; i++) {
            if (_bridgeableTokens[_bridgeableTokenList[i]].isActive) activeCount++;
        }
        BridgeableToken[] memory result = new BridgeableToken[](activeCount);
        uint256 idx = 0;
        for (uint256 i = 0; i < _bridgeableTokenList.length; i++) {
            address addr = _bridgeableTokenList[i];
            if (_bridgeableTokens[addr].isActive) {
                result[idx++] = _bridgeableTokens[addr];
            }
        }
        return result;
    }

    /* ----------------------------------------------------------
       VIEW: Check if a single token is whitelisted
    ---------------------------------------------------------- */
    function isBridgeable(address tokenAddress) external view returns (bool) {
        return _bridgeableTokens[tokenAddress].isActive;
    }

    // ── all existing token factory functions UNCHANGED ─────────

    function createToken(
        string memory name,
        string memory symbol,
        string memory memo,
        uint8 decimals,
        int64 initialSupply,
        int64 maxSupply
    ) external payable returns (address tokenAddress) {

        require(initialSupply >= 0, "Invalid initial supply");
        require(maxSupply >= 0 || maxSupply == 0, "Invalid max supply");
        require(maxSupply == 0 || initialSupply <= maxSupply, "Initial > max supply");

        IHederaTokenService.TokenKey[] memory keys = new IHederaTokenService.TokenKey[](2);
        keys[0] = IHederaTokenService.TokenKey(
            1,
            IHederaTokenService.KeyValue(false, address(this), bytes(""), bytes(""), address(0))
        );
        keys[1] = IHederaTokenService.TokenKey(
            16,
            IHederaTokenService.KeyValue(false, address(this), bytes(""), bytes(""), address(0))
        );

        IHederaTokenService.HederaToken memory token;
        token.name = name;
        token.symbol = symbol;
        token.memo = memo;
        token.treasury = address(this);
        token.tokenSupplyType = maxSupply > 0;
        token.maxSupply = maxSupply > 0 ? maxSupply : int64(0);
        token.freezeDefault = false;
        token.tokenKeys = keys;
        token.expiry = IHederaTokenService.Expiry(0, address(this), 8000000);

        (int responseCode, address createdToken) = HederaTokenService.createFungibleToken(token, initialSupply, int32(uint32(decimals)));
        require(responseCode == HederaResponseCodes.SUCCESS, "Token creation failed");

        tokens[createdToken] = TokenInfo({
            tokenAddress: createdToken,
            creator: msg.sender,
            name: name,
            symbol: symbol,
            decimals: decimals,
            totalMinted: initialSupply,
            maxSupply: maxSupply,
            isActive: true
        });

        allTokens.push(createdToken);

        if (initialSupply > 0) {
            int associateResponse = HederaTokenService.associateToken(msg.sender, createdToken);
            require(
                associateResponse == HederaResponseCodes.SUCCESS ||
                associateResponse == HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT,
                "Association failed"
            );
            int transferResponse = HederaTokenService.transferToken(createdToken, address(this), msg.sender, initialSupply);
            require(transferResponse == HederaResponseCodes.SUCCESS, "Failed to transfer initial supply");
        }

        emit TokenCreated(createdToken, msg.sender, name, symbol, decimals);
        return createdToken;
    }

    function mintTokens(address tokenAddress, int64 amount, address recipient) external payable returns (bool success) {
        require(tokens[tokenAddress].isActive, "Token inactive");
        require(amount > 0, "Amount must be > 0");
        require(recipient != address(0), "Invalid recipient");
        TokenInfo storage tokenInfo = tokens[tokenAddress];
        if (tokenInfo.maxSupply > 0) require(tokenInfo.totalMinted + amount <= tokenInfo.maxSupply, "Exceeds max supply");
        (int responseCode, , ) = HederaTokenService.mintToken(tokenAddress, amount, new bytes[](0));
        require(responseCode == HederaResponseCodes.SUCCESS, "Mint failed");
        tokenInfo.totalMinted += amount;
        int associateResponse = HederaTokenService.associateToken(recipient, tokenAddress);
        require(associateResponse == HederaResponseCodes.SUCCESS || associateResponse == HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT, "Association failed");
        int transferResponse = HederaTokenService.transferToken(tokenAddress, address(this), recipient, amount);
        require(transferResponse == HederaResponseCodes.SUCCESS, "Transfer failed");
        emit TokensMinted(tokenAddress, msg.sender, recipient, amount);
        return true;
    }

    function mintTokensWithoutAssociation(address tokenAddress, int64 amount, address recipient) external payable returns (bool success) {
        require(tokens[tokenAddress].isActive, "Token inactive");
        require(amount > 0, "Amount must be > 0");
        require(recipient != address(0), "Invalid recipient");
        TokenInfo storage tokenInfo = tokens[tokenAddress];
        if (tokenInfo.maxSupply > 0) require(tokenInfo.totalMinted + amount <= tokenInfo.maxSupply, "Exceeds max supply");
        (int responseCode, , ) = HederaTokenService.mintToken(tokenAddress, amount, new bytes[](0));
        require(responseCode == HederaResponseCodes.SUCCESS, "Mint failed");
        tokenInfo.totalMinted += amount;
        int transferResponse = HederaTokenService.transferToken(tokenAddress, address(this), recipient, amount);
        require(transferResponse == HederaResponseCodes.SUCCESS, "Transfer failed");
        emit TokensMinted(tokenAddress, msg.sender, recipient, amount);
        return true;
    }

    function batchMintTokens(address tokenAddress, int64[] memory amounts, address[] memory recipients) external payable returns (bool success) {
        require(tokens[tokenAddress].isActive, "Token inactive");
        require(amounts.length == recipients.length, "Length mismatch");
        require(amounts.length > 0, "Empty arrays");
        TokenInfo storage tokenInfo = tokens[tokenAddress];
        int64 totalAmount = 0;
        for (uint i = 0; i < amounts.length; i++) {
            require(amounts[i] > 0, "Amount must be > 0");
            require(recipients[i] != address(0), "Invalid recipient");
            totalAmount += amounts[i];
        }
        if (tokenInfo.maxSupply > 0) require(tokenInfo.totalMinted + totalAmount <= tokenInfo.maxSupply, "Exceeds max supply");
        (int responseCode, , ) = HederaTokenService.mintToken(tokenAddress, totalAmount, new bytes[](0));
        require(responseCode == HederaResponseCodes.SUCCESS, "Mint failed");
        tokenInfo.totalMinted += totalAmount;
        for (uint i = 0; i < recipients.length; i++) {
            int associateResponse = HederaTokenService.associateToken(recipients[i], tokenAddress);
            require(associateResponse == HederaResponseCodes.SUCCESS || associateResponse == HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT, "Association failed");
            int transferResponse = HederaTokenService.transferToken(tokenAddress, address(this), recipients[i], amounts[i]);
            require(transferResponse == HederaResponseCodes.SUCCESS, "Transfer failed");
            emit TokensMinted(tokenAddress, msg.sender, recipients[i], amounts[i]);
        }
        return true;
    }

    function burnTokens(address tokenAddress, int64 amount) external payable returns (bool success) {
        require(tokens[tokenAddress].isActive, "Token inactive");
        require(amount > 0, "Amount must be > 0");
        require(tokens[tokenAddress].totalMinted >= amount, "Burn > minted");
        (int responseCode, ) = HederaTokenService.burnToken(tokenAddress, amount, new int64[](0));
        require(responseCode == HederaResponseCodes.SUCCESS, "Burn failed");
        tokens[tokenAddress].totalMinted -= amount;
        emit TokensBurned(tokenAddress, msg.sender, amount);
        return true;
    }

    function burnTokensFrom(address tokenAddress, int64 amount, address from) external payable returns (bool success) {
        require(tokens[tokenAddress].isActive, "Token inactive");
        require(amount > 0, "Amount must be > 0");
        require(from != address(0), "Invalid address");
        require(tokens[tokenAddress].totalMinted >= amount, "Burn > minted");
        int transferResponse = HederaTokenService.transferToken(tokenAddress, from, address(this), amount);
        require(transferResponse == HederaResponseCodes.SUCCESS, "Transfer failed");
        (int responseCode, ) = HederaTokenService.burnToken(tokenAddress, amount, new int64[](0));
        require(responseCode == HederaResponseCodes.SUCCESS, "Burn failed");
        tokens[tokenAddress].totalMinted -= amount;
        emit TokensBurned(tokenAddress, from, amount);
        return true;
    }

    function batchBurnTokens(address tokenAddress, int64[] memory amounts, address[] memory fromAccounts) external payable returns (bool success) {
        require(tokens[tokenAddress].isActive, "Token inactive");
        require(amounts.length == fromAccounts.length, "Length mismatch");
        require(amounts.length > 0, "Empty arrays");
        int64 totalAmount = 0;
        for (uint i = 0; i < amounts.length; i++) {
            require(amounts[i] > 0, "Amount must be > 0");
            require(fromAccounts[i] != address(0), "Invalid address");
            totalAmount += amounts[i];
        }
        require(tokens[tokenAddress].totalMinted >= totalAmount, "Burn > minted");
        for (uint i = 0; i < fromAccounts.length; i++) {
            int transferResponse = HederaTokenService.transferToken(tokenAddress, fromAccounts[i], address(this), amounts[i]);
            require(transferResponse == HederaResponseCodes.SUCCESS, "Transfer failed");
        }
        (int responseCode, ) = HederaTokenService.burnToken(tokenAddress, totalAmount, new int64[](0));
        require(responseCode == HederaResponseCodes.SUCCESS, "Burn failed");
        tokens[tokenAddress].totalMinted -= totalAmount;
        for (uint i = 0; i < fromAccounts.length; i++) {
            emit TokensBurned(tokenAddress, fromAccounts[i], amounts[i]);
        }
        return true;
    }

    function getToken(address tokenAddress) external view returns (TokenInfo memory) {
        return tokens[tokenAddress];
    }

    function getTotalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function getTokens(uint256 offset, uint256 limit) external view returns (address[] memory) {
        require(offset < allTokens.length, "Offset out of bounds");
        uint256 end = offset + limit;
        if (end > allTokens.length) end = allTokens.length;
        address[] memory result = new address[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            result[i - offset] = allTokens[i];
        }
        return result;
    }

    function toggleTokenStatus(address tokenAddress) external {
        require(tokens[tokenAddress].creator == msg.sender || msg.sender == owner || isManager[msg.sender], "Only creator, owner or manager can toggle status");
        tokens[tokenAddress].isActive = !tokens[tokenAddress].isActive;
    }

    function withdraw() external onlyOwner {
        (bool success, ) = payable(owner).call{value: address(this).balance}("");
        require(success, "Withdraw failed");
    }

    receive() external payable {}

    /* ----------------------------------------------------------
       BRIDGE: bridge token to Sepolia
    ---------------------------------------------------------- */
    function bridgeToken(
        address tokenAddress,
        int64   amount,
        address receiverOnSepolia
    ) external {
        require(tokenAddress      != address(0), "Bridge: zero token");
        require(amount            >  0,          "Bridge: zero amount");
        require(receiverOnSepolia != address(0), "Bridge: zero receiver");

        BridgeableToken storage bt = _bridgeableTokens[tokenAddress];
        require(bt.isActive, "Bridge: token not whitelisted");

        int transferResponse = HederaTokenService.transferToken(
            tokenAddress, msg.sender, address(this), amount
        );
        require(transferResponse == HederaResponseCodes.SUCCESS, "Bridge: transfer failed");

        emit BridgeInitiated(
            msg.sender,
            tokenAddress,
            bt.name,
            bt.symbol,
            bt.decimals,
            amount,
            receiverOnSepolia,
            block.timestamp
        );
    }

    function returnTokenToUser(
        address tokenAddress,
        address to,
        int64   amount
    ) external onlyOwner {
        require(tokenAddress != address(0), "Bridge: zero token");
        require(to           != address(0), "Bridge: zero recipient");
        require(amount       >  0,          "Bridge: zero amount");

        int associateResponse = HederaTokenService.associateToken(to, tokenAddress);
        require(
            associateResponse == HederaResponseCodes.SUCCESS ||
            associateResponse == HederaResponseCodes.TOKEN_ALREADY_ASSOCIATED_TO_ACCOUNT,
            "Bridge: association failed"
        );

        int transferResponse = HederaTokenService.transferToken(
            tokenAddress, address(this), to, amount
        );
        require(transferResponse == HederaResponseCodes.SUCCESS, "Bridge: return transfer failed");

        emit TokensReturned(to, tokenAddress, amount, block.timestamp);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Bridge: zero address");
        owner = newOwner;
    }
}
