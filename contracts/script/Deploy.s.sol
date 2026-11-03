// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FreelanceEscrow} from "../src/FreelanceEscrow.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/// @notice Deploys FreelanceEscrow. Reads USDC_ADDRESS; if unset or empty (local anvil), deploys MockUSDC first.
/// Usage:
///   forge script script/Deploy.s.sol --rpc-url <RPC> --private-key <KEY> --broadcast
/// Prints `USDC_ADDRESS=0x...` and `ESCROW_ADDRESS=0x...` lines for tooling to parse.
contract Deploy is Script {
    function run() external returns (FreelanceEscrow escrow, address usdc) {
        string memory usdcStr = vm.envOr("USDC_ADDRESS", string(""));

        vm.startBroadcast();
        if (bytes(usdcStr).length == 0) {
            usdc = address(new MockUSDC());
            console.log("Deployed MockUSDC (USDC_ADDRESS was empty)");
        } else {
            usdc = vm.parseAddress(usdcStr);
        }
        escrow = new FreelanceEscrow(usdc);
        vm.stopBroadcast();

        console.log("USDC_ADDRESS=%s", usdc);
        console.log("ESCROW_ADDRESS=%s", address(escrow));
    }
}
