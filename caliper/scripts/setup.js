// Prepares a running local Hardhat node for a Caliper benchmark.
//
//   1. Deploys and wires the contracts with OUR deploy script. Caliper can't do
//      this itself: it deploys with no constructor arguments and no wiring.
//   2. Funds one account per Caliper worker. Each worker needs its own account,
//      or their transaction nonces collide.
//   3. Writes networks/localhost.json (addresses + ABIs) so Caliper uses the
//      contracts we deployed instead of deploying its own.
//   4. Switches the node from "a block per transaction" to a fixed block time,
//      so latency numbers mean something.
//
// Usage (repo root: `npm run node` must already be running):
//   npm run setup                        placeholder contracts (until the real ones exist)
//   BENCH_TARGET=bdims npm run setup     the real contracts
//   BLOCK_TIME_MS=12000 npm run setup    Sepolia-like 12 s blocks (use for the final report)

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Web3 = require("web3");
const EthereumHDKey = require("ethereumjs-wallet/hdkey");

const RPC_HTTP = "http://127.0.0.1:8545";
const RPC_WS = "ws://127.0.0.1:8545";
const REPO_ROOT = path.join(__dirname, "..", "..");
const CALIPER_ROOT = path.join(__dirname, "..");

// Hardhat node account #0. A public, well-known TEST key that only ever holds
// fake local ETH. Never put a real key in this file.
const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Caliper derives worker N's account from this seed at m/44'/60'/N'/0/0.
// We derive the same accounts here so we can fund them.
const WORKER_SEED = "bdims-caliper-local-benchmark-seed";
const MAX_WORKERS = 10;
const WORKER_FUNDING_ETH = "100";

const BLOCK_TIME_MS = Number(process.env.BLOCK_TIME_MS || 2000);
const TARGET = process.env.BENCH_TARGET || "probe";

// What each target deploys, which contracts Caliper calls, and a fixed gas
// limit per write. Fixed limits avoid an estimateGas round trip inside every
// measured transaction.
const TARGETS = {
  probe: {
    deploy: "caliper/scripts/deploy-probe.js",
    manifest: "deployments/localhost-probe.json",
    gas: { ProbeRegistry: { registerBatch: 300000 }, ProbeLedger: {} },
    prepare: async () => {},
  },
  bdims: {
    deploy: "scripts/deploy.js",
    manifest: "deployments/localhost.json",
    gas: { DrugRegistry: {}, SupplyChain: {}, InventoryManager: {} },
    prepare: async () => {
      // TODO (Tarun/Sahil) once the contracts exist: from the admin account,
      // call DrugRegistry.registerParticipant for every worker address
      // (workerAddresses() below) with the role each round needs, e.g.
      // MANUFACTURER for registerBatch. Then fill in the gas limits above.
      throw new Error("The real contracts aren't wired for benchmarking yet. See the TODO in setup.js.");
    },
  },
};

function workerAddresses() {
  const master = EthereumHDKey.fromMasterSeed(WORKER_SEED);
  return Array.from({ length: MAX_WORKERS }, (_, i) =>
    master.derivePath(`m/44'/60'/${i}'/0/0`).getWallet().getChecksumAddressString()
  );
}

async function rpc(method, params = []) {
  const res = await fetch(RPC_HTTP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}

function findArtifact(name) {
  const base = path.join(REPO_ROOT, "artifacts", "contracts");
  const stack = [base];
  while (stack.length) {
    const dir = stack.pop();
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name === `${name}.json`) return JSON.parse(fs.readFileSync(full, "utf8"));
    }
  }
  throw new Error(`No compiled artifact for ${name}. Run "npm run compile" in the repo root.`);
}

async function main() {
  const target = TARGETS[TARGET];
  if (!target) throw new Error(`Unknown BENCH_TARGET "${TARGET}". Use: ${Object.keys(TARGETS).join(", ")}`);

  try {
    const chainId = parseInt(await rpc("eth_chainId"), 16);
    if (chainId !== 31337) throw new Error(`chain ${chainId} is not a local Hardhat node`);
  } catch (err) {
    throw new Error(`No Hardhat node at ${RPC_HTTP} (${err.message}). Start one in the repo root with: npm run node`);
  }

  // Instant blocks while we set up, so deployment doesn't crawl.
  await rpc("evm_setIntervalMining", [0]);
  await rpc("evm_setAutomine", [true]);

  console.log(`Deploying ${TARGET} contracts...`);
  execSync(`npx hardhat run ${target.deploy} --network localhost`, { cwd: REPO_ROOT, stdio: "inherit" });
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, target.manifest), "utf8"));

  console.log(`Funding ${MAX_WORKERS} worker accounts with ${WORKER_FUNDING_ETH} ETH each...`);
  const web3 = new Web3(RPC_HTTP);
  web3.eth.accounts.wallet.add(DEPLOYER_KEY);
  for (const to of workerAddresses()) {
    await web3.eth.sendTransaction({ from: DEPLOYER, to, value: web3.utils.toWei(WORKER_FUNDING_ETH), gas: 21000 });
  }

  await target.prepare({ web3, manifest, workers: workerAddresses() });

  const contracts = {};
  for (const [name, address] of Object.entries(manifest.contracts)) {
    contracts[name] = { address, abi: findArtifact(name).abi, gas: target.gas[name] || {}, estimateGas: true };
  }
  const networkConfig = {
    caliper: { blockchain: "ethereum" },
    ethereum: {
      url: RPC_WS,
      contractDeployerAddress: DEPLOYER,
      contractDeployerAddressPrivateKey: DEPLOYER_KEY,
      fromAddressSeed: WORKER_SEED,
      transactionConfirmationBlocks: 1,
      contracts,
    },
  };
  const out = path.join(CALIPER_ROOT, "networks", "localhost.json");
  fs.writeFileSync(out, JSON.stringify(networkConfig, null, 2) + "\n");
  console.log(`Wrote networks/localhost.json (${Object.keys(contracts).join(", ")})`);

  // Real-network behaviour from here on: a block every BLOCK_TIME_MS.
  await rpc("evm_setAutomine", [false]);
  await rpc("evm_setIntervalMining", [BLOCK_TIME_MS]);
  console.log(`Node now mines a block every ${BLOCK_TIME_MS} ms. Ready: npm run bench`);
}

main().catch((err) => {
  console.error(`\nSetup failed: ${err.message}`);
  process.exitCode = 1;
});
