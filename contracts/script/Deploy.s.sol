// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {FreelanceEscrow} from "../src/FreelanceEscrow.sol";
import {MockUSDC} from "../test/mocks/MockUSDC.sol";

/// @notice Deploys FreelanceEscrow. Reads USDC_ADDRESS; if unset or empty on a local chain (anvil, chainid 31337),
///         deploys MockUSDC first. On any other chain USDC_ADDRESS is required (the script reverts otherwise).
/// The escrow has no owner/admin, so any funded wallet can deploy it.
/// Usage (encrypted Foundry keystore, no raw private key on the command line):
///   cast wallet import deployer --interactive
///   forge script script/Deploy.s.sol --rpc-url <RPC> --account deployer --broadcast
/// Prints `USDC_ADDRESS=0x...` and `ESCROW_ADDRESS=0x...` lines for tooling to parse.
contract Deploy is Script {
    uint256 internal constant LOCAL_CHAIN_ID = 31337;

    error UsdcAddressRequired(uint256 chainId);

    function run() external returns (FreelanceEscrow escrow, address usdc) {
        string memory usdcStr = vm.envOr("USDC_ADDRESS", string(""));
        bool deployMock = bytes(usdcStr).length == 0;
        if (deployMock && block.chainid != LOCAL_CHAIN_ID) {
            // Never ship an open-mint MockUSDC to a public chain by accident.
            revert UsdcAddressRequired(block.chainid);
        }

        vm.startBroadcast();
        if (deployMock) {
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
