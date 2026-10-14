// Prepares a running local Hardhat node for a Caliper benchmark.
//
//   1. Deploys and wires the contracts with OUR deploy script. Caliper can't do
//      this itself: it deploys with no constructor arguments and no wiring.
//   2. Funds one account per Caliper worker. Each worker needs its own account,
//      or their transaction nonces collide.
//   3. For the real contracts, registers every worker with the role its
//      rounds need (see accounts.js for why there are two groups).
//   4. Writes one network config per worker group (addresses + ABIs) so
//      Caliper uses the contracts we deployed instead of deploying its own.
//   5. Switches the node from "a block per transaction" to a fixed block time,
//      so latency numbers mean something.
//
// Usage (repo root: `npm run node` must already be running):
//   npm run setup                        placeholder contracts (until the real ones exist)
//   BENCH_TARGET=bdims npm run setup     the real contracts
//   BLOCK_TIME_MS=12000 npm run setup    Sepolia-like 12 s blocks (use for the final report)
//   BENCH_DEPLOY=existing                skip deploying; use the contracts already in
//                                        the target's manifest (e.g. deployed by hand)

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const Web3 = require("web3");
const { MAX_WORKERS, SEEDS, workerAddresses } = require("../accounts.js");

const RPC_HTTP = "http://127.0.0.1:8545";
const RPC_WS = "ws://127.0.0.1:8545";
const REPO_ROOT = path.join(__dirname, "..", "..");
const CALIPER_ROOT = path.join(__dirname, "..");

// Hardhat node account #0. A public, well-known TEST key that only ever holds
// fake local ETH. Never put a real key in this file.
const DEPLOYER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const DEPLOYER_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const WORKER_FUNDING_ETH = "100";

const BLOCK_TIME_MS = Number(process.env.BLOCK_TIME_MS || 2000);
const TARGET = process.env.BENCH_TARGET || "probe";
const SKIP_DEPLOY = process.env.BENCH_DEPLOY === "existing";

const role = (name) => Web3.utils.keccak256(name);

// What each target deploys, which ABIs Caliper calls through, the worker
// groups (one network config each), and a fixed gas limit per method.
// Fixed limits avoid an estimateGas round trip inside every measured
// transaction, and a reverting estimate would crash the worker instead of
// counting as a failed transaction.
const TARGETS = {
  probe: {
    deploy: "caliper/scripts/deploy-probe.js",
    manifest: "deployments/localhost-probe.json",
    abi: (name) => findArtifact(name).abi,
    groups: { localhost: { seed: SEEDS.probe } },
    gas: { ProbeRegistry: { registerBatch: 300000 }, ProbeLedger: {} },
  },
  bdims: {
    deploy: "scripts/deploy.js",
    manifest: "deployments/localhost.json",
    // The interface ABIs, so this works with any implementation of them.
    abi: (name) => findArtifact(`I${name}`).abi,
    groups: {
      "bdims-manufacturers": { seed: SEEDS.manufacturers, role: "MANUFACTURER_ROLE", label: "Benchmark manufacturer", plural: "manufacturers" },
      "bdims-pharmacies": { seed: SEEDS.pharmacies, role: "PHARMACY_ROLE", label: "Benchmark pharmacy", plural: "pharmacies" },
    },
    // About 1.5-2x what the reference implementation measured. If a round
    // fails with "out of gas", raise its number here and rerun setup.
    gas: {
      DrugRegistry: { registerBatch: 750000, getBatchDetails: 3000000, batchCount: 100000 },
      SupplyChain: { transferCustody: 500000, acceptConsignment: 500000, getCustodyHistory: 3000000 },
      InventoryManager: { dispenseDrug: 350000, flagRecall: 250000 },
    },
  },
};

// Onboards every worker of every group with that group's role, from the
// admin (deployer) account.
async function registerWorkers(web3, manifest, groups) {
  const registry = new web3.eth.Contract(findArtifact("IDrugRegistry").abi, manifest.contracts.DrugRegistry);
  for (const group of Object.values(groups)) {
    if (!group.role) continue;
    const addresses = workerAddresses(group.seed);
    for (const [i, account] of addresses.entries()) {
      if (await registry.methods.isRegistered(account).call()) continue;
      await registry.methods
        .registerParticipant(account, `${group.label} ${i}`, `BENCH-${i}`, role(group.role))
        .send({ from: DEPLOYER, gas: 500000 });
    }
    console.log(`Registered ${addresses.length} workers as ${group.plural}`);
  }
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

  if (SKIP_DEPLOY) {
    console.log(`Using the contracts already in ${target.manifest}`);
  } else {
    console.log(`Deploying ${TARGET} contracts...`);
    execSync(`npx hardhat --config hardhat.config.js run ${target.deploy} --network localhost`, { cwd: REPO_ROOT, stdio: "inherit" });
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, target.manifest), "utf8"));

  const groups = Object.values(target.groups);
  console.log(`Funding ${MAX_WORKERS} worker accounts per group with ${WORKER_FUNDING_ETH} ETH each...`);
  const web3 = new Web3(RPC_HTTP);
  web3.eth.accounts.wallet.add(DEPLOYER_KEY);
  for (const group of groups) {
    for (const to of workerAddresses(group.seed)) {
      await web3.eth.sendTransaction({ from: DEPLOYER, to, value: web3.utils.toWei(WORKER_FUNDING_ETH), gas: 21000 });
    }
  }

  await registerWorkers(web3, manifest, target.groups);

  const contracts = {};
  for (const [name, address] of Object.entries(manifest.contracts)) {
    contracts[name] = { address, abi: target.abi(name), gas: target.gas[name] || {}, estimateGas: true };
  }
  for (const [file, group] of Object.entries(target.groups)) {
    const networkConfig = {
      caliper: { blockchain: "ethereum" },
      ethereum: {
        url: RPC_WS,
        contractDeployerAddress: DEPLOYER,
        contractDeployerAddressPrivateKey: DEPLOYER_KEY,
        fromAddressSeed: group.seed,
        transactionConfirmationBlocks: 1,
        contracts,
      },
    };
    fs.writeFileSync(path.join(CALIPER_ROOT, "networks", `${file}.json`), JSON.stringify(networkConfig, null, 2) + "\n");
    console.log(`Wrote networks/${file}.json (${Object.keys(contracts).join(", ")})`);
  }

  // Real-network behaviour from here on: a block every BLOCK_TIME_MS.
  await rpc("evm_setAutomine", [false]);
  await rpc("evm_setIntervalMining", [BLOCK_TIME_MS]);
  console.log(`Node now mines a block every ${BLOCK_TIME_MS} ms. Ready: npm run ${TARGET === "bdims" ? "bench:bdims" : "bench"}`);
}

main().catch((err) => {
  console.error(`\nSetup failed: ${err.message}`);
  process.exitCode = 1;
});
