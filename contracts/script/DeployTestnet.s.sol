// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FirmSwap} from "../src/FirmSwap.sol";

/// @title MockERC20 — simple mintable ERC20 for testnet
/// @dev Deployed alongside FirmSwap on testnets where real tokens don't exist
contract TestnetToken {
    string public name;
    string public symbol;
    uint8 public decimals;
    uint256 public totalSupply;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name;
        symbol = _symbol;
        decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
        emit Transfer(address(0), to, amount);
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "Insufficient balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        emit Transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "Insufficient balance");
        require(allowance[from][msg.sender] >= amount, "Insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
        return true;
    }
}

/// @title DeployTestnet
/// @notice Deploys FirmSwap + mock tokens to Chiado testnet
/// @dev Usage:
///   forge script script/DeployTestnet.s.sol \
///     --rpc-url https://rpc.chiadochain.net \
///     --broadcast \
///     --private-key $PRIVATE_KEY
///
/// This script:
/// 1. Deploys mock BRLA (18 decimals) and USDC (6 decimals) tokens
/// 2. Deploys FirmSwap with Permit2 and mock USDC as bond token
/// 3. Mints tokens to the deployer for testing
/// 4. Registers deployer as a solver with 10,000 USDC bond
contract DeployTestnet is Script {
    function run() external {
        address permit2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
        address deployer = msg.sender;

        console2.log("=== FirmSwap Testnet Deployment ===");
        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast();

        // 1. Deploy mock tokens
        TestnetToken brla = new TestnetToken("Test BRLA", "tBRLA", 18);
        console2.log("tBRLA deployed at:", address(brla));

        TestnetToken usdc = new TestnetToken("Test USDC", "tUSDC", 6);
        console2.log("tUSDC deployed at:", address(usdc));

        // 2. Deploy FirmSwap
        FirmSwap firmSwap = new FirmSwap(permit2, address(usdc));
        console2.log("FirmSwap deployed at:", address(firmSwap));
        console2.log("DepositProxy creation code hash:", vm.toString(firmSwap.DEPOSIT_PROXY_CREATION_CODE_HASH()));

        // 3. Mint tokens for testing
        // Deployer gets tokens to act as solver + user
        brla.mint(deployer, 1_000_000e18);     // 1M BRLA
        usdc.mint(deployer, 1_000_000e6);       // 1M USDC
        console2.log("Minted 1M tBRLA and 1M tUSDC to deployer");

        // 4. Register deployer as solver with 10,000 USDC bond
        uint256 bondAmount = 10_000e6;
        usdc.approve(address(firmSwap), bondAmount);
        firmSwap.registerSolver(bondAmount);
        console2.log("Registered deployer as solver with 10,000 tUSDC bond");

        // 5. Approve FirmSwap to spend solver's USDC (for fills)
        usdc.approve(address(firmSwap), type(uint256).max);
        console2.log("Approved FirmSwap for unlimited tUSDC spending");

        // 6. Approve FirmSwap to spend user's BRLA (for deposits)
        brla.approve(address(firmSwap), type(uint256).max);
        console2.log("Approved FirmSwap for unlimited tBRLA spending");

        vm.stopBroadcast();

        console2.log("");
        console2.log("=== Deployment Summary ===");
        console2.log("tBRLA:    ", address(brla));
        console2.log("tUSDC:    ", address(usdc));
        console2.log("FirmSwap: ", address(firmSwap));
        console2.log("Solver:   ", deployer);
        console2.log("Bond:     ", bondAmount / 1e6, "USDC");
    }
}
