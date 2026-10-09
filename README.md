# BDIMS: Blockchain-Based Drug Inventory Management System

Blockchain Technology (DSE 4408), Manipal Institute of Technology.

Three Solidity contracts that track every drug batch from manufacture to
dispensing, with role-based access, on-chain expiry enforcement and
single-transaction recall. Deployed to Ethereum Sepolia.

---

## Setup

You need Node 22, Git, VS Code (with the Solidity extension by Nomic
Foundation; VS Code will suggest it when you open the folder) and MetaMask.

```bash
git clone https://github.com/GargiGupta-io/bdims.git
cd bdims
nvm use          # switches to Node 22
npm install
npm test
```

If `npm test` shows **3 passing**, you're set up.

You do **not** need Sepolia test ETH. Everything until week 7 runs on a local
Hardhat chain with 20 accounts holding 10,000 fake ETH each.

---

## Who owns what

| Member | Role | Owns |
|---|---|---|
| Gargi Gupta | Project Lead & System Architect | `contracts/interfaces/`, `contracts/libraries/`, config, deployment, frontend, integration tests, docs |
| Khush Patel | Smart Contract Developer, Registry | `contracts/DrugRegistry.sol`, `test/registry.test.js` |
| Pranav Arora | Smart Contract Developer, Supply Chain | `contracts/SupplyChain.sol`, `test/supplychain.test.js` |
| Ronit Rao | Smart Contract Developer, Inventory | `contracts/InventoryManager.sol`, `test/inventory.test.js` |
| Tarun Harish | Benchmarking Lead (Hyperledger Caliper) | `caliper/` |
| Sahil Vats | Benchmarking, supporting Tarun | `caliper/` |

**Your interface file is your spec.** Every function, event, error, struct
and revert condition is written in `contracts/interfaces/I<YourContract>.sol`.
Start your contract like this:

```solidity
contract DrugRegistry is IDrugRegistry, AccessControl, ReentrancyGuard {
```

and the compiler will tell you every function you still need to write.

---

## Rules

1. **Never edit `contracts/interfaces/` or `contracts/libraries/`.**
   If you need a change, ask Gargi. The other two contracts are built against
   those files, so a silent change breaks someone else's code.
2. **Only edit files you own.** That's how we avoid merge conflicts.
3. **Write tests for your own contract**, including every revert in your
   interface file. Target is 90% statement coverage (`npm run coverage`).
4. **Never commit `.env`** or any private key. It's in `.gitignore`; keep it there.
5. **Use the custom errors** from the interface, not `require` strings. Tests
   check them with `revertedWithCustomError`.

---

## Daily workflow

```bash
git checkout main
git pull
git checkout -b feat/registry        # or feat/supplychain, feat/inventory
# ...write code...
npm test
git add contracts/DrugRegistry.sol test/registry.test.js
git commit -m "add registerBatch with manufacturer check"
git push -u origin feat/registry
```

Then open a pull request on GitHub. Tests run automatically; one approval to
merge. Pull `main` again before starting anything new.

---

## How the three contracts talk to each other

| Caller | Calls | Why |
|---|---|---|
| DrugRegistry | `SupplyChain.initialiseCustody` | Give the manufacturer custody of a new batch |
| SupplyChain | `DrugRegistry.isRegistered`, `hasRole` | Check sender, recipient and route |
| SupplyChain | `InventoryManager.isRecalled`, `checkExpiry`, `getFacilityStock` | Pre-transfer checks |
| SupplyChain | `InventoryManager.updateStock` | Move units (dispatch, accept, return) |
| InventoryManager | `DrugRegistry.hasRole`, `getBatchDetails` | Pharmacy check, expiry date, who may recall |
| InventoryManager | `DrugRegistry.setBatchStatus` | Mark a batch recalled |

Each contract stores the addresses of the others. Calls that change state
(`initialiseCustody`, `updateStock`, `setBatchStatus`) only accept the one
contract allowed to make them.

**Testing your contract before the others exist:** write a small mock in
`test/mocks/` that implements the interface you depend on, with hardcoded
answers. Deploy the mock in your test, pass its address to your constructor.

---

## Design decisions (refining the synopsis)

These tighten the design in synopsis §7. The interfaces are the final word.

1. **A batch can be split across facilities.** A distributor can send 500 of
   a 10,000-unit batch to one pharmacy and 300 to another. So custody is
   tracked as stock per facility in InventoryManager. The synopsis's
   `getCurrentHolder` is replaced by `getAffectedHolders`, which returns
   every facility still holding units. That's also what recall needs.
2. **Transfers use escrow.** `transferCustody` moves units into the
   SupplyChain contract; `acceptConsignment` releases them to the recipient.
   Stock can't be dispatched twice, and units in transit show up during a recall.
3. **Nothing gets stuck.** Added `rejectConsignment` (recipient refuses) and
   `cancelTransfer` (sender withdraws). Both always work, even on a recalled
   batch, so stock can always be returned.
4. **One admin list.** It lives in DrugRegistry. The other two contracts
   ask the registry who the admin is.
5. **Expiry is computed, never stored.** A stored "expired" flag can't flip
   itself when the date passes, so expiry is always `block.timestamp < expiryDate`.
6. **`transferCustody` takes a `location`**, because the synopsis's
   `TransferRecord` includes one.
7. **Allowed routes.** Manufacturer to distributor or pharmacy; distributor
   to distributor or pharmacy. Pharmacies dispense, never send. Regulators
   never hold stock.

---

## Benchmarking with Hyperledger Caliper (Tarun, Sahil)

Caliper fires hundreds of transactions at the contracts and reports
transactions per second, latency and failures. It is the evidence for the
synopsis outcome "transactions confirm within the normal block interval".
It lives in `caliper/` with its own dependencies (Caliper 0.6.0, the last
release with an Ethereum connector, plus web3 1.3.0), so it never clashes
with Hardhat.

```bash
cd caliper && npm install        # once
npm run node                     # repo root, terminal 1: local chain
cd caliper && npm run setup      # terminal 2: deploy, fund workers, write config
npm run bench                    # run the rounds; report in caliper/reports/report.html
```

**Why setup exists.** Caliper normally deploys contracts itself, but only
with no constructor arguments and no wiring between contracts. Ours need
both. So `setup` deploys with our own script, funds one account per Caliper
worker (shared accounts make nonces collide), writes the addresses and ABIs
into `networks/localhost.json`, and Caliper runs with deployment skipped.
It also switches the node from instant blocks to a fixed block time
(2 s by default; `BLOCK_TIME_MS=12000 npm run setup` matches Sepolia and is
the setting for the final report).

**Right now** it benchmarks a temporary placeholder pair
(`contracts/probe/`) that copies the awkward parts of the real design.
Pipeline verified: 200/200 writes at 1.0 s average latency, 1000/1000 reads.

**When the real contracts land:**

1. In `caliper/scripts/setup.js`, fill in the `bdims` target: register each
   worker address with the role its round needs, and set gas limits.
2. Copy `benchmarks/probe.yaml` to `benchmarks/bdims.yaml` with rounds for
   `registerBatch`, `transferCustody` + `acceptConsignment`, `dispenseDrug`,
   `flagRecall`, `getBatchDetails` and `getCustodyHistory`, one workload file
   each in `workloads/bdims/`.
3. Run `BENCH_TARGET=bdims npm run setup`, then the bench against `bdims.yaml`.
4. Delete `contracts/probe/` and the probe files.

## Deployment (Gargi)

```bash
npx hardhat node                 # terminal 1
npm run deploy:local             # terminal 2
```

For Sepolia, copy `.env.example` to `.env`, fill it in, then
`npm run deploy:sepolia`. The script prints the Etherscan verify commands
and writes `deployments/sepolia.json` for the frontend.

---

## Timeline

| Weeks | Milestone |
|---|---|
| 1–2 | M1: Architecture and interfaces frozen |
| 3–4 | M2: DrugRegistry and SupplyChain working locally |
| 5–6 | M3: All three contracts at 90% coverage |
| 7–8 | M4: Live on Sepolia, first dashboard connected |
| 9–10 | M5: All role interfaces complete |
| 11–12 | M6: Integrated, acceptance tests passing |
| 13–14 | M7: Deliverables submitted |
