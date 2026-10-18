
const { expect } = require("chai");
const { ethers } = require("hardhat");
const {
  loadFixture,
  time,
} = require("@nomicfoundation/hardhat-toolbox/network-helpers");

describe("InventoryManager", function () {
  const DAY = 24 * 60 * 60;
  const ZERO = ethers.ZeroAddress;

  const role = (name) =>
    ethers.keccak256(ethers.toUtf8Bytes(name));

  const PHARMACY = role("PHARMACY_ROLE");
  const REGULATOR = role("REGULATOR_ROLE");

  async function deployFixture() {
    // Reserve account 0 for the existing setup tests.
    const signers = await ethers.getSigners();

    const [scAccount, mfg, pharm, pharm2, reg, stranger] =
      signers.slice(1, 7);

    // Deploy using scAccount, not the default account 0.
    const registry = await ethers.deployContract(
      "MockRegistryForInventory",
      [],
      scAccount
    );

    const inv = await ethers.deployContract(
      "InventoryManager",
      [await registry.getAddress(), scAccount.address],
      scAccount
    );

    const expiry = (await time.latest()) + 365 * DAY;

    await registry.setBatch(1, mfg.address, expiry);
    await registry.setRole(PHARMACY, pharm.address);
    await registry.setRole(PHARMACY, pharm2.address);
    await registry.setRole(REGULATOR, reg.address);

    // Initial stock: 1000 units to manufacturer.
    await inv.connect(scAccount).updateStock(
      1, ZERO, mfg.address, 1000
    );

    // Transfer 100 units to pharmacy.
    await inv.connect(scAccount).updateStock(
      1, mfg.address, pharm.address, 100
    );

    return {
      inv,
      registry,
      scAccount,
      mfg,
      pharm,
      pharm2,
      reg,
      stranger,
      expiry,
    };
  }

  describe("Stock management", function () {

    it("tracks initial stock correctly", async function () {
      const { inv, mfg, pharm } =
        await loadFixture(deployFixture);

      expect(await inv.getFacilityStock(mfg.address, 1))
        .to.equal(900n);

      expect(await inv.getFacilityStock(pharm.address, 1))
        .to.equal(100n);

      expect([...(await inv.getAffectedHolders(1))])
        .to.have.members([mfg.address, pharm.address]);
    });

    it("emits StockUpdated on transfer", async function () {
      const { inv, scAccount, mfg, pharm } =
        await loadFixture(deployFixture);

      await expect(
        inv.connect(scAccount).updateStock(
          1, mfg.address, pharm.address, 20
        )
      ).to.emit(inv, "StockUpdated")
        .withArgs(1, mfg.address, pharm.address, 20);
    });

    it("rejects unauthorized stock updates", async function () {
      const { inv, stranger, mfg, pharm } =
        await loadFixture(deployFixture);

      await expect(
        inv.connect(stranger).updateStock(
          1, mfg.address, pharm.address, 10
        )
      ).to.be.revertedWithCustomError(
        inv, "CallerNotSupplyChain"
      ).withArgs(stranger.address);
    });

    it("rejects zero-quantity updates", async function () {
      const { inv, scAccount, mfg, pharm } =
        await loadFixture(deployFixture);

      await expect(
        inv.connect(scAccount).updateStock(
          1, mfg.address, pharm.address, 0
        )
      ).to.be.revertedWithCustomError(
        inv, "ZeroQuantity"
      );
    });

    it("rejects transfers exceeding available stock", async function () {
      const { inv, scAccount, mfg, pharm } =
        await loadFixture(deployFixture);

      await expect(
        inv.connect(scAccount).updateStock(
          1, pharm.address, mfg.address, 101
        )
      ).to.be.revertedWithCustomError(
        inv, "InsufficientStock"
      ).withArgs(1, pharm.address, 100, 101);
    });

    it("removes a holder when their balance reaches zero", async function () {
      const { inv, pharm, mfg } =
        await loadFixture(deployFixture);

      await inv.connect(pharm).dispenseDrug(1, 100);

      expect(await inv.getFacilityStock(pharm.address, 1))
        .to.equal(0n);

      expect([...(await inv.getAffectedHolders(1))])
        .to.have.members([mfg.address]);
    });

    it("correctly removes a middle holder using swap-and-pop", async function () {
      const { inv, scAccount, mfg, pharm, pharm2, reg } =
        await loadFixture(deployFixture);

      await inv.connect(scAccount).updateStock(
        1, mfg.address, pharm2.address, 50
      );

      await inv.connect(scAccount).updateStock(
        1, mfg.address, reg.address, 20
      );

      await inv.connect(pharm).dispenseDrug(1, 100);

      const holders = [
        ...(await inv.getAffectedHolders(1)),
      ];

      expect(holders).to.have.members([
        mfg.address,
        pharm2.address,
        reg.address,
      ]);

      expect(holders).to.have.length(3);
    });
  });

  describe("Dispensing", function () {

    it("allows a pharmacy to dispense medicine", async function () {
      const { inv, pharm } =
        await loadFixture(deployFixture);

      await expect(
        inv.connect(pharm).dispenseDrug(1, 40)
      ).to.emit(inv, "DrugDispensed")
        .withArgs(1, pharm.address, 40);

      expect(await inv.getFacilityStock(pharm.address, 1))
        .to.equal(60n);

      const log = await inv.getDispensingLog(1);

      expect(log).to.have.length(1);
      expect(log[0].pharmacy).to.equal(pharm.address);
      expect(log[0].quantity).to.equal(40n);
      expect(log[0].timestamp).to.be.greaterThan(0n);
    });

    it("rejects dispensing more than available", async function () {
      const { inv, pharm } =
        await loadFixture(deployFixture);

      await expect(
        inv.connect(pharm).dispenseDrug(1, 150)
      ).to.be.revertedWithCustomError(
        inv, "InsufficientStock"
      ).withArgs(1, pharm.address, 100, 150);
    });

    it("rejects non-pharmacy dispensing", async function () {
      const { inv, stranger } =
        await loadFixture(deployFixture);

      await expect(
        inv.connect(stranger).dispenseDrug(1, 10)
      ).to.be.revertedWithCustomError(
        inv, "NotPharmacy"
      ).withArgs(stranger.address);
    });

    it("rejects dispensing zero units", async function () {
      const { inv, pharm } =
        await loadFixture(deployFixture);

      await expect(
        inv.connect(pharm).dispenseDrug(1, 0)
      ).to.be.revertedWithCustomError(
        inv, "ZeroQuantity"
      );
    });

    it("rejects expired medicine", async function () {
      const { inv, pharm } =
        await loadFixture(deployFixture);

      await time.increase(366 * DAY);

      expect(await inv.checkExpiry(1)).to.equal(false);

      await expect(
        inv.connect(pharm).dispenseDrug(1, 10)
      ).to.be.revertedWithCustomError(
        inv, "BatchIsExpired"
      ).withArgs(1);
    });
  });

  describe("Batch recall", function () {

    it("allows a regulator to recall a batch", async function () {
      const { inv, registry, reg } =
        await loadFixture(deployFixture);

      await expect(
        inv.connect(reg).flagRecall(1, "Quality issue")
      ).to.emit(inv, "BatchRecalled")
        .withArgs(1, reg.address, "Quality issue");

      expect(await inv.isRecalled(1)).to.equal(true);
      expect(await registry.lastStatus(1)).to.equal(1n);
    });

    it("allows the manufacturer to recall their batch", async function () {
      const { inv, registry, mfg } =
        await loadFixture(deployFixture);

      await inv.connect(mfg).flagRecall(
        1, "Manufacturing defect"
      );

      expect(await inv.isRecalled(1)).to.equal(true);
      expect(await registry.lastStatus(1)).to.equal(1n);
    });

    it("rejects unauthorized recall attempts", async function () {
      const { inv, stranger } =
        await loadFixture(deployFixture);

      await expect(
        inv.connect(stranger).flagRecall(1, "Fake recall")
      ).to.be.revertedWithCustomError(
        inv, "NotAuthorisedToRecall"
      ).withArgs(stranger.address);
    });

    it("rejects recalling the same batch twice", async function () {
      const { inv, reg } =
        await loadFixture(deployFixture);

      await inv.connect(reg).flagRecall(1, "Defect");

      await expect(
        inv.connect(reg).flagRecall(1, "Again")
      ).to.be.revertedWithCustomError(
        inv, "AlreadyRecalled"
      ).withArgs(1);
    });

    it("rejects recalls of nonexistent batches", async function () {
      const { inv, registry, reg } =
        await loadFixture(deployFixture);

      await expect(
        inv.connect(reg).flagRecall(42, "Unknown batch")
      ).to.be.revertedWithCustomError(
        registry, "BatchNotFound"
      ).withArgs(42);
    });

    it("blocks dispensing after a recall", async function () {
      const { inv, reg, pharm } =
        await loadFixture(deployFixture);

      await inv.connect(reg).flagRecall(1, "Unsafe");

      await expect(
        inv.connect(pharm).dispenseDrug(1, 10)
      ).to.be.revertedWithCustomError(
        inv, "BatchIsRecalled"
      ).withArgs(1);
    });

    it("allows stock movement after recall for returns", async function () {
      const { inv, scAccount, mfg, pharm, reg } =
        await loadFixture(deployFixture);

      await inv.connect(reg).flagRecall(1, "Unsafe");

      await inv.connect(scAccount).updateStock(
        1, pharm.address, mfg.address, 100
      );

      expect(await inv.getFacilityStock(pharm.address, 1))
        .to.equal(0n);

      expect(await inv.getFacilityStock(mfg.address, 1))
        .to.equal(1000n);
    });
  });

  describe("Alerts and thresholds", function () {

    it("stores facility-specific reorder thresholds", async function () {
      const { inv, pharm, pharm2 } =
        await loadFixture(deployFixture);

      await inv.connect(pharm).setReorderThreshold(1, 80);
      await inv.connect(pharm2).setReorderThreshold(1, 30);

      expect(
        await inv.getReorderThreshold(pharm.address, 1)
      ).to.equal(80n);

      expect(
        await inv.getReorderThreshold(pharm2.address, 1)
      ).to.equal(30n);
    });

    it("emits LowStockAlert below the threshold", async function () {
      const { inv, pharm } =
        await loadFixture(deployFixture);

      await inv.connect(pharm).setReorderThreshold(1, 80);

      await expect(
        inv.connect(pharm).dispenseDrug(1, 40)
      ).to.emit(inv, "LowStockAlert")
        .withArgs(1, pharm.address, 60, 80);
    });

    it("warns when dispensing medicine near expiry", async function () {
      const { inv, registry, mfg, pharm } =
        await loadFixture(deployFixture);

      const expiry = (await time.latest()) + 10 * DAY;

      await registry.setBatch(1, mfg.address, expiry);

      await expect(
        inv.connect(pharm).dispenseDrug(1, 10)
      ).to.emit(inv, "ExpiryWarning")
        .withArgs(1, expiry);
    });

    it("warns when transferring medicine near expiry", async function () {
      const { inv, registry, scAccount, mfg, pharm } =
        await loadFixture(deployFixture);

      const expiry = (await time.latest()) + 10 * DAY;

      await registry.setBatch(1, mfg.address, expiry);

      await expect(
        inv.connect(scAccount).updateStock(
          1, mfg.address, pharm.address, 10
        )
      ).to.emit(inv, "ExpiryWarning")
        .withArgs(1, expiry);
    });

    it("does not warn when expiry is far away", async function () {
      const { inv, pharm } =
        await loadFixture(deployFixture);

      await expect(
        inv.connect(pharm).dispenseDrug(1, 10)
      ).to.not.emit(inv, "ExpiryWarning");
    });
  });
});
