// Fills a LOCAL chain with demo data so every dashboard has something to show:
// five participants (one per role), three batches, and custody moves in
// every state (accepted, pending, recalled).
//
// Uses only functions from contracts/interfaces/, so it works against any
// implementation of them.
//
//   npm run node          (terminal 1)
//   npm run deploy:local  (terminal 2)
//   npm run seed:local
//
// Local Hardhat accounts used (import their keys into MetaMask to act as them;
// `npm run node` prints every key):
//   #0 admin   #1 manufacturer   #2 distributor   #3 distributor
//   #4 pharmacy   #5 regulator

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

const role = (name) => hre.ethers.keccak256(hre.ethers.toUtf8Bytes(name));
const DAY = 24 * 60 * 60;

async function main() {
  const { ethers, network } = hre;
  if (network.name !== "localhost" && network.name !== "hardhat") {
    throw new Error("seed.js only runs on a local chain. It would put fake companies on " + network.name + ".");
  }
  const manifestPath = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  if (!fs.existsSync(manifestPath)) throw new Error(`No ${manifestPath}. Deploy first.`);
  const { contracts } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const [admin, mfg, dist1, dist2, pharm, reg] = await ethers.getSigners();
  const registry = await ethers.getContractAt("IDrugRegistry", contracts.DrugRegistry);
  const supply = await ethers.getContractAt("ISupplyChain", contracts.SupplyChain);
  const inventory = await ethers.getContractAt("IInventoryManager", contracts.InventoryManager);
  const send = async (txPromise) => (await txPromise).wait();

  console.log("Registering participants...");
  const people = [
    [mfg, "Cipla Ltd", "MFG-MH-2041", "MANUFACTURER_ROLE"],
    [dist1, "MedLine Distributors", "DST-KA-1187", "DISTRIBUTOR_ROLE"],
    [dist2, "Apex Pharma Logistics", "DST-MH-0932", "DISTRIBUTOR_ROLE"],
    [pharm, "Apollo Pharmacy, Manipal", "PH-KA-5520", "PHARMACY_ROLE"],
    [reg, "CDSCO Drug Inspector", "REG-IN-0007", "REGULATOR_ROLE"],
  ];
  for (const [signer, name, licence, r] of people) {
    if (await registry.isRegistered(signer.address)) continue;
    await send(registry.connect(admin).registerParticipant(signer.address, name, licence, role(r)));
  }

  console.log("Registering batches...");
  const now = (await ethers.provider.getBlock("latest")).timestamp;
  const batches = [
    ["Paracetamol 500mg", "Paracetamol IP 500 mg", now - 20 * DAY, now + 700 * DAY, 10000, "bafkreiparacetamolqacertificate0001"],
    ["Amoxicillin 250mg", "Amoxicillin trihydrate IP 250 mg", now - 10 * DAY, now + 400 * DAY, 5000, "bafkreiamoxicillinqacertificate0002"],
    ["Insulin Glargine 100IU", "Insulin glargine 100 IU/ml", now - 5 * DAY, now + 25 * DAY, 800, "bafkreiinsulinqacertificate00000003"],
  ];
  const first = Number(await registry.batchCount()) + 1;
  for (const b of batches) await send(registry.connect(mfg).registerBatch(...b));
  const [para, amox, insulin] = [first, first + 1, first + 2];

  console.log("Moving stock...");
  // Paracetamol: three hops to the pharmacy, then some dispensed.
  await send(supply.connect(mfg).transferCustody(para, dist1.address, 4000, "Goa plant to Bengaluru hub"));
  await send(supply.connect(dist1).acceptConsignment(para));
  await send(supply.connect(dist1).transferCustody(para, dist2.address, 1500, "Bengaluru hub to Mangaluru"));
  await send(supply.connect(dist2).acceptConsignment(para));
  await send(supply.connect(dist2).transferCustody(para, pharm.address, 300, "Mangaluru to Manipal"));
  await send(supply.connect(pharm).acceptConsignment(para));
  await send(inventory.connect(pharm).dispenseDrug(para, 25));
  // Amoxicillin: dispatched, still in transit (pending acceptance).
  await send(supply.connect(mfg).transferCustody(amox, dist1.address, 1200, "Goa plant to Bengaluru hub"));
  // Insulin: delivered to the pharmacy, then recalled by the regulator.
  await send(supply.connect(mfg).transferCustody(insulin, pharm.address, 200, "Goa plant to Manipal"));
  await send(supply.connect(pharm).acceptConsignment(insulin));
  await send(inventory.connect(reg).flagRecall(insulin, "Cold-chain breach reported at Goa plant"));

  console.log(`Seeded: batches ${para}, ${amox}, ${insulin}.`);
  for (const [signer, name] of people) console.log(`  ${name.padEnd(26)} ${signer.address}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
