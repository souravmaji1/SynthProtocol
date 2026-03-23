// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ============================================================
//  ERC-20 Token (deployed per call) — UNCHANGED
// ============================================================

contract ERC20Token {
    string  public name;
    string  public symbol;
    uint8   public decimals;
    uint256 public totalSupply;
    address public owner;

    mapping(address => uint256)                       public balanceOf;
    mapping(address => mapping(address => uint256))   public allowance;

    event Transfer(address indexed from,    address indexed to,      uint256 value);
    event Approval(address indexed owner_,  address indexed spender, uint256 value);
    event Mint    (address indexed to,      uint256 value);
    event Burn    (address indexed from,    uint256 value);

    modifier onlyOwner() {
        require(msg.sender == owner, "ERC20: not owner");
        _;
    }

    constructor(
        string  memory _name,
        string  memory _symbol,
        uint8          _decimals,
        uint256        _initialSupply,
        address        _owner
    ) {
        require(bytes(_name).length   > 0, "ERC20: empty name");
        require(bytes(_symbol).length > 0, "ERC20: empty symbol");
        require(_decimals <= 18,           "ERC20: decimals > 18");
        require(_owner != address(0),      "ERC20: zero owner");

        name        = _name;
        symbol      = _symbol;
        decimals    = _decimals;
        owner       = _owner;

        if (_initialSupply > 0) {
            _mint(_owner, _initialSupply);
        }
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        require(allowed >= amount, "ERC20: insufficient allowance");
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }

    function burnOwn(uint256 amount) external {
        _burn(msg.sender, amount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "ERC20: zero address");
        owner = newOwner;
    }

    function renounceOwnership() external onlyOwner {
        owner = address(0);
    }

    function _transfer(address from, address to, uint256 amount) internal {
        require(to != address(0),             "ERC20: transfer to zero");
        require(balanceOf[from] >= amount,    "ERC20: insufficient balance");
        balanceOf[from] -= amount;
        balanceOf[to]   += amount;
        emit Transfer(from, to, amount);
    }

    function _mint(address to, uint256 amount) internal {
        require(to != address(0), "ERC20: mint to zero");
        totalSupply    += amount;
        balanceOf[to]  += amount;
        emit Transfer(address(0), to, amount);
        emit Mint(to, amount);
    }

    function _burn(address from, uint256 amount) internal {
        require(balanceOf[from] >= amount, "ERC20: burn exceeds balance");
        balanceOf[from] -= amount;
        totalSupply     -= amount;
        emit Transfer(from, address(0), amount);
        emit Burn(from, amount);
    }
}

// ============================================================
//  TokenFactory — UNCHANGED (no manager needed here)
// ============================================================

contract TokenFactory {

    struct TokenInfo {
        address tokenAddress;
        string  name;
        string  symbol;
        uint8   decimals;
        uint256 initialSupply;
        address creator;
        uint256 createdAt;
    }

    TokenInfo[] public allTokens;
    mapping(address => address[]) public tokensByCreator;
    mapping(address => uint256)   private _tokenIndex;

    event TokenCreated(
        address indexed creator,
        address indexed tokenAddress,
        string  name,
        string  symbol,
        uint8   decimals,
        uint256 initialSupply,
        uint256 timestamp
    );

    function createToken(
        string  memory _name,
        string  memory _symbol,
        uint8          _decimals,
        uint256        _initialSupply
    ) external returns (address tokenAddress) {

        uint256 rawSupply = _initialSupply * (10 ** uint256(_decimals));

        ERC20Token token = new ERC20Token(
            _name, _symbol, _decimals, rawSupply, msg.sender
        );

        tokenAddress = address(token);

        TokenInfo memory info = TokenInfo({
            tokenAddress : tokenAddress,
            name         : _name,
            symbol       : _symbol,
            decimals     : _decimals,
            initialSupply: _initialSupply,
            creator      : msg.sender,
            createdAt    : block.timestamp
        });

        allTokens.push(info);
        tokensByCreator[msg.sender].push(tokenAddress);
        _tokenIndex[tokenAddress] = allTokens.length;

        emit TokenCreated(msg.sender, tokenAddress, _name, _symbol, _decimals, _initialSupply, block.timestamp);
    }

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    function getTokens(uint256 offset, uint256 limit)
        external view returns (TokenInfo[] memory slice)
    {
        uint256 total = allTokens.length;
        if (offset >= total) return slice;
        uint256 end = offset + limit;
        if (end > total) end = total;
        slice = new TokenInfo[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            slice[i - offset] = allTokens[i];
        }
    }

    function getTokensByCreator(address creator)
        external view returns (address[] memory)
    {
        return tokensByCreator[creator];
    }

    function getTokenInfo(address tokenAddress)
        external view returns (TokenInfo memory)
    {
        uint256 idx = _tokenIndex[tokenAddress];
        require(idx != 0, "Factory: token not registered");
        return allTokens[idx - 1];
    }
}

// ============================================================
//  SepoliaBridge — with token whitelist + MANAGER SUPPORT
// ============================================================

contract SepoliaBridge {

    address public owner;

    // ── Manager state ─────────────────────────────────────────
    mapping(address => bool) public isManager;
    address[] private _managerList;

    event ManagerAdded(address indexed manager, address indexed addedBy);
    event ManagerRemoved(address indexed manager, address indexed removedBy);

    // ── Whitelist ─────────────────────────────────────────────
    struct BridgeableToken {
        address tokenAddress;
        string  name;
        string  symbol;
        uint8   decimals;
        bool    isActive;
    }

    mapping(address => BridgeableToken) private _bridgeableTokens;
    address[] private _bridgeableTokenList;

    event TokenWhitelisted(address indexed tokenAddress, string name, string symbol, uint8 decimals);
    event TokenRemovedFromWhitelist(address indexed tokenAddress);

    event BridgeInitiated(
        address indexed sender,
        address indexed tokenAddress,
        string          tokenName,
        string          tokenSymbol,
        uint8           decimals,
        uint256         amount,
        address         receiverOnHedera,
        uint256         timestamp
    );

    event TokensReturned(
        address indexed receiver,
        address indexed tokenAddress,
        uint256         amount,
        uint256         timestamp
    );

    modifier onlyOwner() {
        require(msg.sender == owner, "Bridge: not owner");
        _;
    }

    modifier onlyOwnerOrManager() {
        require(msg.sender == owner || isManager[msg.sender], "Bridge: not owner or manager");
        _;
    }

    constructor() {
        owner = msg.sender;
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
    function addBridgeableToken(address tokenAddress) external onlyOwnerOrManager {
        require(tokenAddress != address(0), "Bridge: zero token");
        ERC20Token token = ERC20Token(tokenAddress);
        string memory tName    = token.name();
        string memory tSymbol  = token.symbol();
        uint8         tDec     = token.decimals();

        if (_bridgeableTokens[tokenAddress].tokenAddress == address(0)) {
            _bridgeableTokenList.push(tokenAddress);
        }
        _bridgeableTokens[tokenAddress] = BridgeableToken({
            tokenAddress: tokenAddress,
            name:         tName,
            symbol:       tSymbol,
            decimals:     tDec,
            isActive:     true
        });
        emit TokenWhitelisted(tokenAddress, tName, tSymbol, tDec);
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

    /* ----------------------------------------------------------
       USER: Bridge tokens (whitelist enforced)
    ---------------------------------------------------------- */
    function bridgeToken(
        address tokenAddress,
        uint256 amount,
        address receiverOnHedera
    ) external {
        require(tokenAddress != address(0),     "Bridge: zero token");
        require(amount > 0,                     "Bridge: zero amount");
        require(receiverOnHedera != address(0), "Bridge: zero receiver");
        require(_bridgeableTokens[tokenAddress].isActive, "Bridge: token not whitelisted");

        ERC20Token token = ERC20Token(tokenAddress);

        require(
            token.allowance(msg.sender, address(this)) >= amount,
            "Bridge: insufficient allowance"
        );
        token.transferFrom(msg.sender, address(this), amount);

        emit BridgeInitiated(
            msg.sender,
            tokenAddress,
            token.name(),
            token.symbol(),
            token.decimals(),
            amount,
            receiverOnHedera,
            block.timestamp
        );
    }

    function returnTokenToUser(
        address tokenAddress,
        address to,
        uint256 amount
    ) external onlyOwner {
        require(tokenAddress != address(0), "Bridge: zero token");
        require(to           != address(0), "Bridge: zero recipient");
        require(amount       >  0,          "Bridge: zero amount");

        ERC20Token token = ERC20Token(tokenAddress);
        require(token.balanceOf(address(this)) >= amount, "Bridge: insufficient locked balance");

        token.transfer(to, amount);
        emit TokensReturned(to, tokenAddress, amount, block.timestamp);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Bridge: zero address");
        owner = newOwner;
    }
}


