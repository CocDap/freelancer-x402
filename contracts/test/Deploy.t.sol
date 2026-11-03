// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {FreelanceEscrow} from "../src/FreelanceEscrow.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";

/// @dev The script reads USDC_ADDRESS from the process environment, which is shared by all tests running in
///      parallel, so every scenario lives in one test function and runs sequentially.
contract DeployScriptTest is Test {
    function test_deployScriptUsdcSelection() public {
        Deploy script = new Deploy();

        // Empty USDC on a local chain (anvil) -> MockUSDC is deployed and wired into the escrow.
        vm.chainId(31337);
        vm.setEnv("USDC_ADDRESS", "");
        (FreelanceEscrow localEscrow, address localUsdc) = script.run();
        assertGt(localUsdc.code.length, 0, "mock deployed");
        assertEq(MockUSDC(localUsdc).decimals(), 6);
        assertEq(address(localEscrow.usdc()), localUsdc);

        // Empty USDC on Fuji (43113) -> revert, never deploy a mock on a public chain.
        vm.chainId(43113);
        vm.setEnv("USDC_ADDRESS", "");
        vm.expectRevert(abi.encodeWithSelector(Deploy.UsdcAddressRequired.selector, uint256(43113)));
        script.run();

        // USDC configured -> used as-is.
        address fujiUsdc = 0x5425890298aed601595a70AB815c96711a31Bc65;
        vm.setEnv("USDC_ADDRESS", vm.toString(fujiUsdc));
        (FreelanceEscrow escrow, address usdc) = script.run();
        assertEq(usdc, fujiUsdc);
        assertEq(address(escrow.usdc()), fujiUsdc);
        assertEq(fujiUsdc.code.length, 0, "no mock deployed at the configured address");

        vm.setEnv("USDC_ADDRESS", "");
    }
}
