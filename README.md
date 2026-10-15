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

**Testing your contract before the others exist:** use the ready-made mocks
in `contracts/mocks/` (they must live under `contracts/`, because that is the
only folder Hardhat compiles). Each has only the functions your contract
calls, plus setters to shape the test. Step-by-step guides for each
developer are in `docs/guides/`.

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

**The real benchmark** is ready and waits only for the three contracts:

```bash
npm run node                                   # repo root, terminal 1
cd caliper && BENCH_TARGET=bdims npm run setup # deploy, register workers, write configs
npm run bench:bdims                            # both parts; reports in caliper/reports/
```

A Caliper worker can only sign as one account, and our steps need
different roles, so it runs in two parts with two sets of worker accounts
(`caliper/accounts.js`):

| Part | Workers are | Rounds |
|---|---|---|
| `bdims-manufacturers.yaml` | manufacturers | `registerBatch` (touches all three contracts), `transferCustody` to a pharmacy, `flagRecall`, reads `getBatchDetails` and `getCustodyHistory` |
| `bdims-pharmacies.yaml` | pharmacies | `acceptConsignment` of what part 1 dispatched, `dispenseDrug` |

Setup registers every worker with its role from the admin account, uses the
interface ABIs (so any implementation works), and sets a fixed gas limit per
method in `scripts/setup.js`. If a round fails with "out of gas", raise that
number and rerun setup. Keep both yaml files on the same worker count:
manufacturer worker N dispatches to pharmacy worker N.

Verified end to end against stand-in implementations of the interfaces at
2 s blocks: every round 100% successful (300 registrations, 100 dispatches,
50 recalls, 100 acceptances, 200 dispenses, 2,000 reads), about 1 s average
write latency. For the final report, rerun on the real contracts with
`BLOCK_TIME_MS=12000`.

`npm run setup` with no target still runs the placeholder pipeline check
(`contracts/probe/`, `benchmarks/probe.yaml`). Delete those once the real
benchmark has run on the real contracts.

## Frontend (Gargi)

React 18 + Vite + Tailwind, talking to the contracts through Ethers.js. It
uses **only the interface ABIs** (`frontend/src/abi/`, copied by
`npm run sync-abi`), so it works with any implementation of them, and it
reads contract addresses from `deployments/<network>.json`.

What you see depends on the role the registry gives your wallet address:

| Screen | Who | What it does |
|---|---|---|
| Manufacturer | MANUFACTURER | Register batches, live stock, dispatch, cancel transfers in transit, custody trail, recall |
| Distributor | DISTRIBUTOR | Accept or reject incoming consignments, forward stock, cancel transfers in transit, custody trail |
| Pharmacy | PHARMACY | Accept or reject consignments, dispense, reorder levels, alerts for recalled, expiring and low stock, dispensing record |
| Regulator | REGULATOR | Every batch on the network with search and status filters, who holds each one, recall any batch, recall history, units of unsafe stock still held |
| Admin | ADMIN (the deployer) | Onboard participants, change a participant's role, revoke access |
| Verify a medicine | Anyone, no wallet | Enter a batch number (or open `#/verify/<batch>`): genuine, not recognised, recalled or expired, with the custody trail |

Run it locally:

```bash
npm run node                     # terminal 1: local chain
npm run deploy:local             # terminal 2: deploy the contracts
npm run seed:local               # demo participants, batches and transfers
cd frontend && npm install && npm run dev
```

Open the printed address. On the local chain you can pick **"act as a local
test account"** (no wallet needed), or connect MetaMask: add the network
`http://127.0.0.1:8545`, chain ID 31337, and import a key printed by
`npm run node`. `scripts/seed.js` lists which account plays which role;
accounts #6 to #9 are left unregistered for onboarding during a demo.
If MetaMask complains about nonces after restarting the node, use
Settings → Advanced → Clear activity tab data.

### QA certificates on IPFS

Each batch stores the CID of its QA certificate. A CID is a fingerprint of
the file's exact bytes, so anyone who fetches it knows it hasn't been
swapped. Two ways to get one, both through Pinata (free tier):

- **In the app:** "Register a batch" has an upload button. The manufacturer
  pastes their own Pinata key (Files: Write); it is saved only in their
  browser, and "Forget it" removes it. The key is never part of the built
  site, because anything in the site ships to every visitor.
- **In the terminal:** `npm run upload:cert -- certificate.pdf` uses
  `PINATA_JWT` from `.env` and prints the CID.

Files are uploaded as **public**, so the verification page can link to them
through `https://gateway.pinata.cloud/ipfs/<cid>` (set `VITE_IPFS_GATEWAY` to
use another gateway). Not ipfs.io: it now refuses plain requests.

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
