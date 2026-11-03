# contracts

`FreelanceEscrow` (Foundry, solc 0.8.28, EVM Cancun).

Dependencies:
- OpenZeppelin Contracts 5 comes from the repo-root `node_modules` (`pnpm install` at the repo root), remapped in `foundry.toml`.
- `forge-std` is vendored under `lib/forge-std`.

```sh
pnpm install            # at repo root, provides @openzeppelin/contracts
cd contracts
forge test -vv
forge script script/Deploy.s.sol --rpc-url <RPC> --private-key <KEY> --broadcast
```

`Deploy.s.sol` reads `USDC_ADDRESS`; when it is empty it deploys `MockUSDC` first (local anvil).
It prints `USDC_ADDRESS=0x...` and `ESCROW_ADDRESS=0x...`.
