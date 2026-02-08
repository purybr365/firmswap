// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title QuoteLib
/// @notice EIP-712 type hashing for FirmSwap quotes
library QuoteLib {
    enum OrderType {
        EXACT_INPUT,
        EXACT_OUTPUT
    }

    struct FirmSwapQuote {
        address solver;
        address user;
        address inputToken;
        uint256 inputAmount;
        address outputToken;
        uint256 outputAmount;
        OrderType orderType;
        uint256 outputChainId;
        uint32 depositDeadline;
        uint32 fillDeadline;
        uint256 nonce;
    }

    bytes32 internal constant QUOTE_TYPEHASH = keccak256(
        "FirmSwapQuote("
        "address solver,"
        "address user,"
        "address inputToken,"
        "uint256 inputAmount,"
        "address outputToken,"
        "uint256 outputAmount,"
        "uint8 orderType,"
        "uint256 outputChainId,"
        "uint32 depositDeadline,"
        "uint32 fillDeadline,"
        "uint256 nonce"
        ")"
    );

    /// @notice Compute the EIP-712 struct hash of a quote (calldata)
    function hash(FirmSwapQuote calldata quote) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                QUOTE_TYPEHASH,
                quote.solver,
                quote.user,
                quote.inputToken,
                quote.inputAmount,
                quote.outputToken,
                quote.outputAmount,
                uint8(quote.orderType),
                quote.outputChainId,
                quote.depositDeadline,
                quote.fillDeadline,
                quote.nonce
            )
        );
    }

    /// @notice Compute the EIP-712 struct hash of a quote (memory)
    function hashMemory(FirmSwapQuote memory quote) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                QUOTE_TYPEHASH,
                quote.solver,
                quote.user,
                quote.inputToken,
                quote.inputAmount,
                quote.outputToken,
                quote.outputAmount,
                uint8(quote.orderType),
                quote.outputChainId,
                quote.depositDeadline,
                quote.fillDeadline,
                quote.nonce
            )
        );
    }
}
