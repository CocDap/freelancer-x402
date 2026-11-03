# contracts

`FreelanceEscrow` (Foundry, solc 0.8.28, EVM Cancun).

Dependencies:
- OpenZeppelin Contracts 5 comes from the repo-root `node_modules` (`pnpm install` at the repo root), remapped in `foundry.toml`.
- `forge-std` is vendored under `lib/forge-std`.

```sh
pnpm install            # at repo root, provides @openzeppelin/contracts
cd contracts
forge test -vv
cast wallet import deployer --interactive      # one-time: encrypted keystore
forge script script/Deploy.s.sol --rpc-url <RPC> --account deployer --broadcast
```

`Deploy.s.sol` reads `USDC_ADDRESS`. When it is empty and the chain id is 31337 (local anvil) it deploys `MockUSDC` first;
on any other chain an empty `USDC_ADDRESS` makes the script revert. The escrow has no owner/admin, so any funded wallet can deploy it.
It prints `USDC_ADDRESS=0x...` and `ESCROW_ADDRESS=0x...`.
