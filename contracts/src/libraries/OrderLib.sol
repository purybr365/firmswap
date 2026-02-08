// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {QuoteLib} from "./QuoteLib.sol";

/// @title OrderLib
/// @notice Order ID computation and CREATE2 address prediction
library OrderLib {
    /// @notice Compute a unique order ID from quote + solver signature
    /// @dev Used as the key for the orders mapping and as CREATE2 salt
    function computeOrderId(
        QuoteLib.FirmSwapQuote calldata quote,
        bytes calldata solverSignature
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(QuoteLib.hash(quote), keccak256(solverSignature)));
    }

    /// @notice Compute order ID from memory-based quote (for scripts/tests)
    function computeOrderIdMemory(
        QuoteLib.FirmSwapQuote memory quote,
        bytes memory solverSignature
    ) internal pure returns (bytes32) {
        return keccak256(abi.encode(QuoteLib.hashMemory(quote), keccak256(solverSignature)));
    }

    /// @notice Predict the CREATE2 address for a DepositProxy
    /// @param deployer The FirmSwap contract address
    /// @param salt The order ID (used as CREATE2 salt)
    /// @param creationCodeHash The keccak256 of the DepositProxy creation code
    function computeDepositAddress(
        address deployer,
        bytes32 salt,
        bytes32 creationCodeHash
    ) internal pure returns (address) {
        return address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(bytes1(0xff), deployer, salt, creationCodeHash)
                    )
                )
            )
        );
    }
}
