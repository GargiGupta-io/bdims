// End-to-end: the three real contracts deployed and wired exactly like
// scripts/deploy.js, driven through a batch's whole life. This is where the
// contracts meet for the first time, so it catches behaviour mismatches the
// per-contract unit tests (which use mocks) cannot.
//
// Each test maps to a measurable outcome in synopsis section 10.3.
// It skips itself until all three contracts exist.

const { expect } = require("chai");
const hre = require("hardhat");
const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const { ethers } = hre;
const role = (name) => ethers.id(name);
const DAY = 86400;

async function system() {
  const [admin, mfg, dist1, dist2, pharm, reg, stranger] = await ethers.getSigners();
  const registry = await ethers.deployContract("DrugRegistry", [admin.address]);
  const supply = await ethers.deployContract("SupplyChain", [await registry.getAddress()]);
  const inventory = await ethers.deployContract("InventoryManager", [await registry.getAddress(), await supply.getAddress()]);
  await registry.setSupplyChain(await supply.getAddress());
  await registry.setInventoryManager(await inventory.getAddress());
  await supply.setInventoryManager(await inventory.getAddress());

  await registry.registerParticipant(mfg.address, "Cipla Ltd", "MFG-1", role("MANUFACTURER_ROLE"));
  await registry.registerParticipant(dist1.address, "MedLine", "DST-1", role("DISTRIBUTOR_ROLE"));
  await registry.registerParticipant(dist2.address, "Apex", "DST-2", role("DISTRIBUTOR_ROLE"));
  await registry.registerParticipant(pharm.address, "Apollo", "PH-1", role("PHARMACY_ROLE"));
  await registry.registerParticipant(reg.address, "CDSCO", "REG-1", role("REGULATOR_ROLE"));

  const now = await time.latest();
  await registry.connect(mfg).registerBatch("Paracetamol 500mg", "Paracetamol IP", now - DAY, now + 365 * DAY, 10000, "bafkreicert");
  return { registry, supply, inventory, admin, mfg, dist1, dist2, pharm, reg, stranger };
}

const hop = async (supply, from, to, quantity) => {
  await supply.connect(from).transferCustody(1, to.address, quantity, "route");
  await supply.connect(to).acceptConsignment(1);
};

describe("Integration: full batch lifecycle", function () {
  before(async function () {
    for (const name of ["DrugRegistry", "SupplyChain", "InventoryManager"]) {
      if (!(await hre.artifacts.artifactExists(name))) this.skip();
    }
  });

  it("outcome 1: registered, three custody hops, dispensed, full provenance in one query", async function () {
    const { supply, inventory, mfg, dist1, dist2, pharm } = await loadFixture(system);
    await hop(supply, mfg, dist1, 1000);
    await hop(supply, dist1, dist2, 600);
    await hop(supply, dist2, pharm, 200);
    await inventory.connect(pharm).dispenseDrug(1, 50);

    const trail = [...(await supply.getCustodyHistory(1))];
    expect(trail.map((r) => r.to)).to.deep.equal([mfg.address, dist1.address, dist2.address, pharm.address]);
    expect(trail[0].from).to.equal(ethers.ZeroAddress);
    expect(await inventory.getFacilityStock(pharm.address, 1)).to.equal(150);
    expect(await inventory.getFacilityStock(mfg.address, 1)).to.equal(9000);
  });

  it("outcome 2: an expired batch is rejected on transfer and on dispensing", async function () {
    const { supply, inventory, mfg, pharm } = await loadFixture(system);
    await hop(supply, mfg, pharm, 100);
    await time.increase(366 * DAY);
    await expect(supply.connect(mfg).transferCustody(1, pharm.address, 1, "x")).to.be.revertedWithCustomError(supply, "BatchIsExpired");
    await expect(inventory.connect(pharm).dispenseDrug(1, 1)).to.be.revertedWithCustomError(inventory, "BatchIsExpired");
  });

  it("outcome 2+3: a recall freezes transfer, acceptance and dispensing in the same block", async function () {
    const { registry, supply, inventory, mfg, dist1, pharm, reg } = await loadFixture(system);
    await hop(supply, mfg, pharm, 100);
    await supply.connect(mfg).transferCustody(1, dist1.address, 500, "in transit");
    await inventory.connect(reg).flagRecall(1, "contamination");

    await expect(supply.connect(mfg).transferCustody(1, pharm.address, 1, "x")).to.be.revertedWithCustomError(supply, "BatchIsRecalled");
    await expect(supply.connect(dist1).acceptConsignment(1)).to.be.revertedWithCustomError(supply, "BatchIsRecalled");
    await expect(inventory.connect(pharm).dispenseDrug(1, 1)).to.be.revertedWithCustomError(inventory, "BatchIsRecalled");
    expect((await registry.getBatchDetails(1)).status).to.equal(1); // Recalled
  });

  it("outcome 3: a recall returns every holder, including stock in transit", async function () {
    const { supply, inventory, mfg, dist1, pharm, reg } = await loadFixture(system);
    await hop(supply, mfg, pharm, 100);
    await supply.connect(mfg).transferCustody(1, dist1.address, 500, "in transit");
    await inventory.connect(mfg).flagRecall(1, "defect");
    expect([...(await inventory.getAffectedHolders(1))]).to.have.members([mfg.address, pharm.address, await supply.getAddress()]);
  });

  it("recalled stock can still be returned to the manufacturer", async function () {
    const { supply, inventory, mfg, dist1, reg } = await loadFixture(system);
    await supply.connect(mfg).transferCustody(1, dist1.address, 500, "in transit");
    await inventory.connect(reg).flagRecall(1, "defect");
    await supply.connect(dist1).rejectConsignment(1, "recalled");
    expect(await inventory.getFacilityStock(mfg.address, 1)).to.equal(10000);
  });

  it("outcome 4: an unregistered batch ID fails verification", async function () {
    const { registry } = await loadFixture(system);
    await expect(registry.getBatchDetails(999)).to.be.revertedWithCustomError(registry, "BatchNotFound").withArgs(999);
  });

  it("only the right roles can act across contracts", async function () {
    const { registry, supply, inventory, mfg, dist1, pharm, stranger } = await loadFixture(system);
    await hop(supply, mfg, pharm, 100);
    await expect(registry.connect(dist1).registerBatch("X", "x", 1, 2e9, 1, "Qm")).to.be.revertedWithCustomError(registry, "AccessControlUnauthorizedAccount");
    await expect(supply.connect(pharm).transferCustody(1, dist1.address, 1, "x")).to.be.revertedWithCustomError(supply, "InvalidRoute");
    await expect(inventory.connect(dist1).dispenseDrug(1, 1)).to.be.revertedWithCustomError(inventory, "NotPharmacy");
    await expect(inventory.connect(stranger).flagRecall(1, "x")).to.be.revertedWithCustomError(inventory, "NotAuthorisedToRecall");
  });
});
