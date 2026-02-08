// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {FirmSwap} from "../src/FirmSwap.sol";

/// @title Deploy
/// @notice Deploys FirmSwap to a target chain
/// @dev Usage:
///   forge script script/Deploy.s.sol --rpc-url $RPC_URL --broadcast --verify
///
/// Required environment variables:
///   PRIVATE_KEY    — deployer private key
///   PERMIT2        — Permit2 address on target chain
///   BOND_TOKEN     — Bond token (USDC) address on target chain
///
/// Known addresses:
///   Permit2 (all chains): 0x000000000022D473030F116dDEE9F6B43aC78BA3
///   USDC on Gnosis:       0xDDAfbb505ad214D7b80b1f830fcCc89B60fb7A83
///   USDC on Polygon:      0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359
contract Deploy is Script {
    function run() external {
        address permit2 = vm.envAddress("PERMIT2");
        address bondToken = vm.envAddress("BOND_TOKEN");

        console2.log("Deploying FirmSwap...");
        console2.log("  Permit2:   ", permit2);
        console2.log("  Bond Token:", bondToken);
        console2.log("  Chain ID:  ", block.chainid);

        vm.startBroadcast();

        FirmSwap firmSwap = new FirmSwap(permit2, bondToken);

        vm.stopBroadcast();

        console2.log("FirmSwap deployed at:", address(firmSwap));
        console2.log("DepositProxy creation code hash:", vm.toString(firmSwap.DEPOSIT_PROXY_CREATION_CODE_HASH()));
    }
}
