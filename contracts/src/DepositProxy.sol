// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title DepositProxy
/// @notice Minimal CREATE2-deployed proxy for address deposits.
///         Tokens are sent to the deterministic address before this contract
///         is deployed. Once deployed, FirmSwap calls sweep() to retrieve them.
/// @dev ~100 bytes of runtime bytecode. Only callable by FirmSwap.
contract DepositProxy {
    using SafeERC20 for IERC20;

    address public immutable FIRM_SWAP;

    constructor(address _firmSwap) {
        FIRM_SWAP = _firmSwap;
    }

    /// @notice Transfer all of a token's balance to `to`. Only callable by FirmSwap.
    /// @param token The ERC20 token to sweep
    /// @param to The destination address
    function sweep(address token, address to) external {
        require(msg.sender == FIRM_SWAP, "DepositProxy: only FirmSwap");
        uint256 bal = IERC20(token).balanceOf(address(this));
        if (bal > 0) {
            IERC20(token).safeTransfer(to, bal);
        }
    }
}
