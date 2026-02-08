// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IERC7683
/// @notice Minimal interface for ERC-7683 cross-chain intent standard compatibility
/// @dev See https://eips.ethereum.org/EIPS/eip-7683

/// @notice Tokens that are to be received by the filler on the destination chain
struct Output {
    bytes32 token;
    uint256 amount;
    bytes32 recipient;
    uint256 chainId;
}

/// @notice Tokens that are to be received by the user on the destination chain
struct FillInstruction {
    uint64 destinationChainId;
    bytes32 destinationSettler;
    bytes originData;
}

/// @notice A resolved cross-chain order to be emitted in Open events
struct ResolvedCrossChainOrder {
    address user;
    uint256 originChainId;
    uint32 openDeadline;
    uint32 fillDeadline;
    bytes32 orderId;
    Output[] maxSpent;
    Output[] minReceived;
    FillInstruction[] fillInstructions;
}

/// @title IOriginSettler
/// @notice Standard interface for the origin-side settler contract
interface IOriginSettler {
    /// @notice Signals that an order has been opened
    event Open(bytes32 indexed orderId, ResolvedCrossChainOrder resolvedOrder);

    /// @notice Opens a cross-chain order on behalf of a user
    function openFor(
        bytes calldata order,
        bytes calldata signature,
        bytes calldata originFillerData
    ) external;

    /// @notice Resolves a cross-chain order into a detailed ResolvedCrossChainOrder
    function resolveFor(
        bytes calldata order,
        bytes calldata originFillerData
    ) external view returns (ResolvedCrossChainOrder memory);
}

/// @title IDestinationSettler
/// @notice Standard interface for the destination-side settler contract
interface IDestinationSettler {
    /// @notice Fills a single leg of a particular order on the destination chain
    function fill(bytes32 orderId, bytes calldata originData, bytes calldata fillerData) external;
}
