// Puts demo data on the live Sepolia deployment, so the public Verify page
// and every dashboard show real on-chain batches: five fictional
// participants (one per role), three batches, and custody moves in every
// state (accepted, in transit, recalled).
//
//   SEED_CIDS=<paracetamol CID>,<amoxicillin CID>,<insulin CID> npm run seed:sepolia
//
// The CIDs are QA certificates already uploaded with `npm run upload:cert`.
// Safe to rerun: it skips anything already done.
// The deployer (PRIVATE_KEY in .env) is the admin. The five participants are
// fresh test wallets, created on the first run and kept in
// .env.demo-wallets.json (gitignored, like .env). Each gets a little Sepolia
// ETH from the deployer for gas. Import a key from that file into MetaMask to
// use a dashboard as that participant.

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const role = (name) => hre.ethers.keccak256(hre.ethers.toUtf8Bytes(name));
const DAY = 24 * 60 * 60;
const WALLETS = process.env.SEED_WALLETS || path.join(__dirname, "..", ".env.demo-wallets.json");
const GAS_FUNDING = "0.03";

const PEOPLE = [
  ["manufacturer", "Udupi Generics Ltd (demo)", "DEMO-MFG-001", "MANUFACTURER_ROLE"],
  ["distributor1", "Coastal Pharma Distributors (demo)", "DEMO-DST-001", "DISTRIBUTOR_ROLE"],
  ["distributor2", "Malpe Medical Logistics (demo)", "DEMO-DST-002", "DISTRIBUTOR_ROLE"],
  ["pharmacy", "Campus Pharmacy, Manipal (demo)", "DEMO-PH-001", "PHARMACY_ROLE"],
  ["regulator", "Drug Inspector (demo)", "DEMO-REG-001", "REGULATOR_ROLE"],
];

function loadWallets(provider) {
  let keys = {};
  if (fs.existsSync(WALLETS)) keys = JSON.parse(fs.readFileSync(WALLETS, "utf8"));
  for (const [who] of PEOPLE) keys[who] ??= hre.ethers.Wallet.createRandom().privateKey;
  fs.writeFileSync(WALLETS, JSON.stringify(keys, null, 2) + "\n", { mode: 0o600 });
  return Object.fromEntries(Object.entries(keys).map(([who, key]) => [who, new hre.ethers.Wallet(key, provider)]));
}

async function main() {
  const { ethers, network } = hre;
  // "hardhat" is the throwaway in-process chain, for a dry run.
  if (network.name !== "sepolia" && network.name !== "hardhat") throw new Error("seed-sepolia.js only runs with --network sepolia.");
  const cids = (process.env.SEED_CIDS || "").split(",");
  if (cids.length !== 3 || cids.some((c) => !c)) throw new Error("Set SEED_CIDS to the three certificate CIDs (see the header).");

  const manifest = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  const { contracts } = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const [admin] = await ethers.getSigners();
  const w = loadWallets(ethers.provider);
  const registry = await ethers.getContractAt("IDrugRegistry", contracts.DrugRegistry);
  const supply = await ethers.getContractAt("ISupplyChain", contracts.SupplyChain);
  const inventory = await ethers.getContractAt("IInventoryManager", contracts.InventoryManager);
  const send = async (txPromise) => (await txPromise).wait();

  console.log("Funding participant wallets...");
  for (const [who] of PEOPLE) {
    if ((await ethers.provider.getBalance(w[who].address)) >= ethers.parseEther("0.01")) continue;
    await send(admin.sendTransaction({ to: w[who].address, value: ethers.parseEther(GAS_FUNDING) }));
  }

  console.log("Registering participants...");
  for (const [who, name, licence, r] of PEOPLE) {
    if ((await registry.getParticipant(w[who].address)).role !== ethers.ZeroHash) continue;
    await send(registry.connect(admin).registerParticipant(w[who].address, name, licence, role(r)));
  }

  if ((await registry.batchCount()) > 0n) {
    console.log("Batches already exist; not seeding them twice.");
    return;
  }
  console.log("Registering batches...");
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const { manufacturer: mfg, distributor1: dist1, distributor2: dist2, pharmacy: pharm, regulator: reg } = w;
  await send(registry.connect(mfg).registerBatch("Paracetamol 500mg", "Paracetamol IP 500 mg", now - 20 * DAY, now + 700 * DAY, 10000, cids[0]));
  await send(registry.connect(mfg).registerBatch("Amoxicillin 250mg", "Amoxicillin trihydrate IP 250 mg", now - 10 * DAY, now + 400 * DAY, 5000, cids[1]));
  await send(registry.connect(mfg).registerBatch("Insulin Glargine 100IU", "Insulin glargine 100 IU/ml", now - 5 * DAY, now + 25 * DAY, 800, cids[2]));

  console.log("Moving stock...");
  // Batch 1: three hops to the pharmacy, then some dispensed.
  await send(supply.connect(mfg).transferCustody(1, dist1.address, 4000, "Udupi plant to Mangaluru hub"));
  await send(supply.connect(dist1).acceptConsignment(1));
  await send(supply.connect(dist1).transferCustody(1, dist2.address, 1500, "Mangaluru hub to Malpe"));
  await send(supply.connect(dist2).acceptConsignment(1));
  await send(supply.connect(dist2).transferCustody(1, pharm.address, 300, "Malpe to Manipal"));
  await send(supply.connect(pharm).acceptConsignment(1));
  await send(inventory.connect(pharm).dispenseDrug(1, 25));
  // Batch 2: dispatched, still in transit.
  await send(supply.connect(mfg).transferCustody(2, dist1.address, 1200, "Udupi plant to Mangaluru hub"));
  // Batch 3: delivered to the pharmacy, then recalled by the regulator.
  await send(supply.connect(mfg).transferCustody(3, pharm.address, 200, "Udupi plant to Manipal"));
  await send(supply.connect(pharm).acceptConsignment(3));
  await send(inventory.connect(reg).flagRecall(3, "Demo recall: cold-chain breach reported at the plant"));

  console.log("Seeded batches 1, 2, 3.");
  for (const [who, name] of PEOPLE) console.log(`  ${name.padEnd(36)} ${w[who].address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
