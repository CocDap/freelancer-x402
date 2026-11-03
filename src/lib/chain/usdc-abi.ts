import { parseAbi } from "viem";

/** Subset of Circle USDC (FiatToken v2) used by the relay; MockUSDC implements the same surface. */
export const usdcAbi = parseAbi([
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function balanceOf(address account) view returns (uint256)",
  "function transfer(address to, uint256 value) returns (bool)",
  "function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  // MockUSDC custom errors (real USDC reverts with strings); listed so viem can decode them.
  "error CallerMustBePayee()",
  "error AuthorizationNotYetValid()",
  "error AuthorizationExpired()",
  "error AuthorizationUsedOrCanceled()",
  "error InvalidSignature()",
]);

/** EIP-3009 typed data for `receiveWithAuthorization`. */
export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;
