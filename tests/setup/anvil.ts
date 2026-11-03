// Vitest globalSetup: boots a local anvil chain, deploys MockUSDC + FreelanceEscrow with the Foundry
// Deploy script, and publishes the addresses to test files via `provide`/`inject("anvil")`.
// Runs in the main vitest process (not in test workers), so it must not rely on process env mutation.
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { TestProject } from "vitest/node";

export type AnvilContext = {
  rpcUrl: string;
  chainId: number;
  usdc: `0x${string}`;
  escrow: `0x${string}`;
  /** anvil account #0: deployer and relayer. */
  relayerKey: `0x${string}`;
  /** anvil account #1: funded helper for test-only txs (minting MockUSDC). */
  funderKey: `0x${string}`;
};

declare module "vitest" {
  export interface ProvidedContext {
    anvil: AnvilContext;
  }
}

const PORT = 8546;
const RPC_URL = `http://127.0.0.1:${PORT}`;
// Well-known anvil dev keys (mnemonic "test test ... junk"); never hold real funds.
const ANVIL_KEY_0 = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const ANVIL_KEY_1 = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const CONTRACTS_DIR = path.resolve(__dirname, "../../contracts");

async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const res = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: unknown };
  if (json.error) throw new Error(`${method}: ${JSON.stringify(json.error)}`);
  return json.result;
}

async function isUp(): Promise<boolean> {
  try {
    await rpc("eth_chainId");
    return true;
  } catch {
    return false;
  }
}

async function waitUntilReady(proc: ChildProcess, timeoutMs = 15_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (proc.exitCode !== null) throw new Error(`anvil exited early with code ${proc.exitCode}`);
    if (await isUp()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`anvil did not become ready on ${RPC_URL} within ${timeoutMs}ms`);
}

function run(cmd: string, args: string[], extra: Record<string, string> = {}): string {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...extra };
  const out = spawnSync(cmd, args, { cwd: CONTRACTS_DIR, env: childEnv, encoding: "utf8" });
  if (out.error) throw out.error;
  if (out.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${out.status}):\n${out.stdout}\n${out.stderr}`);
  }
  return out.stdout;
}

export default async function setup(project: TestProject) {
  if (await isUp()) {
    throw new Error(`Port ${PORT} is already serving JSON-RPC; stop that process before running tests.`);
  }

  const anvil = spawn("anvil", ["--port", String(PORT), "--silent"], { stdio: "ignore" });
  const kill = () => {
    if (anvil.exitCode === null) anvil.kill("SIGTERM");
  };
  process.once("exit", kill);

  try {
    await waitUntilReady(anvil);

    run("forge", ["build"]);
    const stdout = run(
      "forge",
      ["script", "script/Deploy.s.sol", "--rpc-url", RPC_URL, "--private-key", ANVIL_KEY_0, "--broadcast"],
      // Empty USDC_ADDRESS makes the script deploy MockUSDC first.
      { USDC_ADDRESS: "" },
    );

    const usdc = stdout.match(/USDC_ADDRESS=(0x[0-9a-fA-F]{40})/)?.[1];
    const escrow = stdout.match(/ESCROW_ADDRESS=(0x[0-9a-fA-F]{40})/)?.[1];
    if (!usdc || !escrow) throw new Error(`Could not parse deployed addresses from forge output:\n${stdout}`);

    const chainId = Number(await rpc("eth_chainId"));
    project.provide("anvil", {
      rpcUrl: RPC_URL,
      chainId,
      usdc: usdc as `0x${string}`,
      escrow: escrow as `0x${string}`,
      relayerKey: ANVIL_KEY_0,
      funderKey: ANVIL_KEY_1,
    });
  } catch (err) {
    kill();
    throw err;
  }

  return async () => {
    kill();
    process.removeListener("exit", kill);
  };
}
