const { expect } = require("chai");
const { ethers } = require("hardhat");
const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const role = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
const MANUFACTURER = role("MANUFACTURER_ROLE");
const DISTRIBUTOR = role("DISTRIBUTOR_ROLE");
const PHARMACY = role("PHARMACY_ROLE");
const REGULATOR = role("REGULATOR_ROLE");
const ZERO = ethers.ZeroAddress;

describe("SupplyChain", function () {
  async function deployFixture() {
    const [admin, mfg, dist, dist2, pharm, reg, stranger] = await ethers.getSigners();
    const registry = await ethers.deployContract("MockRegistryForSupplyChain");
    const inventory = await ethers.deployContract("MockInventoryForSupplyChain");
    const sc = await ethers.deployContract("SupplyChain", [await registry.getAddress()]);
    await registry.setParticipant(admin.address, ethers.ZeroHash); // 0x00 is the admin role
    await registry.setParticipant(mfg.address, MANUFACTURER);
    await registry.setParticipant(dist.address, DISTRIBUTOR);
    await registry.setParticipant(dist2.address, DISTRIBUTOR);
    await registry.setParticipant(pharm.address, PHARMACY);
    await registry.setParticipant(reg.address, REGULATOR);
    await sc.setInventoryManager(await inventory.getAddress());
    // Batch 1: the manufacturer starts with 1000 units
    await registry.callInitialiseCustody(await sc.getAddress(), 1, mfg.address, 1000);
    const scAddr = await sc.getAddress();
    return { sc, scAddr, registry, inventory, admin, mfg, dist, dist2, pharm, reg, stranger };
  }

  // ------------------------------------------------------------ deployment

  describe("deployment and wiring", function () {
    it("stores the registry and inventory addresses", async function () {
      const { sc, registry, inventory } = await loadFixture(deployFixture);
      expect(await sc.registry()).to.equal(await registry.getAddress());
      expect(await sc.inventory()).to.equal(await inventory.getAddress());
    });

    it("rejects a zero registry address", async function () {
      const factory = await ethers.getContractFactory("SupplyChain");
      await expect(factory.deploy(ZERO)).to.be.revertedWithCustomError(factory, "ZeroAddress");
    });

    it("non-admin calling setInventoryManager reverts NotAdmin", async function () {
      const registry = await ethers.deployContract("MockRegistryForSupplyChain");
      const sc = await ethers.deployContract("SupplyChain", [await registry.getAddress()]);
      const [, , , , , , stranger] = await ethers.getSigners();
      await expect(sc.connect(stranger).setInventoryManager(stranger.address))
        .to.be.revertedWithCustomError(sc, "NotAdmin")
        .withArgs(stranger.address);
    });

    it("setInventoryManager rejects the zero address", async function () {
      const [admin] = await ethers.getSigners();
      const registry = await ethers.deployContract("MockRegistryForSupplyChain");
      const sc = await ethers.deployContract("SupplyChain", [await registry.getAddress()]);
      await registry.setParticipant(admin.address, ethers.ZeroHash);
      await expect(sc.setInventoryManager(ZERO)).to.be.revertedWithCustomError(sc, "ZeroAddress");
    });

    it("setInventoryManager can only be called once", async function () {
      const { sc, stranger } = await loadFixture(deployFixture);
      await expect(sc.setInventoryManager(stranger.address)).to.be.revertedWithCustomError(
        sc,
        "AddressAlreadySet"
      );
    });
  });

  // ------------------------------------------------------ initialiseCustody

  describe("initialiseCustody", function () {
    it("starts the trail with a manufacture record and gives the manufacturer stock", async function () {
      const { sc, inventory, mfg } = await loadFixture(deployFixture);
      const trail = [...(await sc.getCustodyHistory(1))];
      expect(trail.length).to.equal(1);
      expect(trail[0].from).to.equal(ZERO);
      expect(trail[0].to).to.equal(mfg.address);
      expect(trail[0].quantity).to.equal(1000n);
      expect(trail[0].location).to.equal("Manufactured");
      expect(await inventory.getFacilityStock(mfg.address, 1)).to.equal(1000n);
    });

    it("emits CustodyInitialised", async function () {
      const { sc, scAddr, registry, mfg } = await loadFixture(deployFixture);
      await expect(registry.callInitialiseCustody(scAddr, 2, mfg.address, 50))
        .to.emit(sc, "CustodyInitialised")
        .withArgs(2, mfg.address, 50);
    });

    it("stranger calling initialiseCustody reverts CallerNotRegistry", async function () {
      const { sc, stranger, mfg } = await loadFixture(deployFixture);
      await expect(sc.connect(stranger).initialiseCustody(1, mfg.address, 100))
        .to.be.revertedWithCustomError(sc, "CallerNotRegistry")
        .withArgs(stranger.address);
    });
  });

  // ------------------------------------------------------------ happy paths

  describe("transfers", function () {
    it("manufacturer -> distributor, distributor accepts", async function () {
      const { sc, scAddr, inventory, mfg, dist } = await loadFixture(deployFixture);

      await expect(sc.connect(mfg).transferCustody(1, dist.address, 400, "Mumbai warehouse"))
        .to.emit(sc, "CustodyTransferInitiated")
        .withArgs(1, mfg.address, dist.address, 400);

      // Units sit in escrow while in transit
      expect(await inventory.getFacilityStock(mfg.address, 1)).to.equal(600n);
      expect(await inventory.getFacilityStock(scAddr, 1)).to.equal(400n);
      expect(await sc.hasPendingTransfer(1, dist.address)).to.equal(true);
      const p = await sc.getPendingTransfer(1, dist.address);
      expect(p.from).to.equal(mfg.address);
      expect(p.quantity).to.equal(400n);
      expect(p.location).to.equal("Mumbai warehouse");

      await expect(sc.connect(dist).acceptConsignment(1))
        .to.emit(sc, "CustodyTransferAccepted")
        .withArgs(1, mfg.address, dist.address, 400);

      expect(await inventory.getFacilityStock(dist.address, 1)).to.equal(400n);
      expect(await inventory.getFacilityStock(scAddr, 1)).to.equal(0n);
      expect(await sc.hasPendingTransfer(1, dist.address)).to.equal(false);

      const trail = [...(await sc.getCustodyHistory(1))];
      expect(trail.length).to.equal(2);
      expect(trail[1].from).to.equal(mfg.address);
      expect(trail[1].to).to.equal(dist.address);
      expect(trail[1].quantity).to.equal(400n);
      expect(trail[1].location).to.equal("Mumbai warehouse");
    });

    it("three hops: mfg -> dist -> dist2 -> pharmacy", async function () {
      const { sc, inventory, mfg, dist, dist2, pharm } = await loadFixture(deployFixture);
      await sc.connect(mfg).transferCustody(1, dist.address, 500, "Plant");
      await sc.connect(dist).acceptConsignment(1);
      await sc.connect(dist).transferCustody(1, dist2.address, 300, "Hub A");
      await sc.connect(dist2).acceptConsignment(1);
      await sc.connect(dist2).transferCustody(1, pharm.address, 100, "Hub B");
      await sc.connect(pharm).acceptConsignment(1);

      const trail = [...(await sc.getCustodyHistory(1))];
      expect(trail.length).to.equal(4);
      expect(trail[0].from).to.equal(ZERO);
      expect(trail.map((r) => r.to)).to.deep.equal([
        mfg.address,
        dist.address,
        dist2.address,
        pharm.address,
      ]);
      expect(await inventory.getFacilityStock(pharm.address, 1)).to.equal(100n);
    });

    it("manufacturer can ship straight to a pharmacy", async function () {
      const { sc, inventory, mfg, pharm } = await loadFixture(deployFixture);
      await sc.connect(mfg).transferCustody(1, pharm.address, 10, "Plant");
      await sc.connect(pharm).acceptConsignment(1);
      expect(await inventory.getFacilityStock(pharm.address, 1)).to.equal(10n);
    });

    it("one batch can be pending to several recipients at once", async function () {
      const { sc, mfg, dist, pharm } = await loadFixture(deployFixture);
      await sc.connect(mfg).transferCustody(1, dist.address, 500, "Plant");
      await sc.connect(mfg).transferCustody(1, pharm.address, 300, "Plant");
      expect(await sc.hasPendingTransfer(1, dist.address)).to.equal(true);
      expect(await sc.hasPendingTransfer(1, pharm.address)).to.equal(true);
    });

    it("accepting the same consignment twice reverts NoPendingTransfer", async function () {
      const { sc, mfg, dist } = await loadFixture(deployFixture);
      await sc.connect(mfg).transferCustody(1, dist.address, 400, "Plant");
      await sc.connect(dist).acceptConsignment(1);
      await expect(sc.connect(dist).acceptConsignment(1))
        .to.be.revertedWithCustomError(sc, "NoPendingTransfer")
        .withArgs(1, dist.address);
    });
  });

  // -------------------------------------------------------- validation order

  describe("validateTransfer", function () {
    it("non-holder (stock 0) reverts InsufficientStock", async function () {
      const { sc, dist, pharm } = await loadFixture(deployFixture);
      await expect(sc.connect(dist).transferCustody(1, pharm.address, 1, "X"))
        .to.be.revertedWithCustomError(sc, "InsufficientStock")
        .withArgs(1, 0, 1);
    });

    it("sending more than held reverts InsufficientStock with the right numbers", async function () {
      const { sc, mfg, dist } = await loadFixture(deployFixture);
      await expect(sc.connect(mfg).transferCustody(1, dist.address, 1001, "X"))
        .to.be.revertedWithCustomError(sc, "InsufficientStock")
        .withArgs(1, 1000, 1001);
    });

    it("transfer to an unregistered stranger reverts NotRegistered", async function () {
      const { sc, mfg, stranger } = await loadFixture(deployFixture);
      await expect(sc.connect(mfg).transferCustody(1, stranger.address, 10, "X"))
        .to.be.revertedWithCustomError(sc, "NotRegistered")
        .withArgs(stranger.address);
    });

    it("unregistered sender reverts NotRegistered (sender checked first)", async function () {
      const { sc, stranger, dist } = await loadFixture(deployFixture);
      await expect(sc.connect(stranger).transferCustody(1, dist.address, 10, "X"))
        .to.be.revertedWithCustomError(sc, "NotRegistered")
        .withArgs(stranger.address);
    });

    it("pharmacy -> distributor reverts InvalidRoute", async function () {
      const { sc, pharm, dist } = await loadFixture(deployFixture);
      await expect(sc.connect(pharm).transferCustody(1, dist.address, 10, "X"))
        .to.be.revertedWithCustomError(sc, "InvalidRoute")
        .withArgs(PHARMACY, DISTRIBUTOR);
    });

    it("distributor -> manufacturer reverts InvalidRoute", async function () {
      const { sc, mfg, dist } = await loadFixture(deployFixture);
      await sc.connect(mfg).transferCustody(1, dist.address, 100, "Plant");
      await sc.connect(dist).acceptConsignment(1);
      await expect(sc.connect(dist).transferCustody(1, mfg.address, 10, "X"))
        .to.be.revertedWithCustomError(sc, "InvalidRoute")
        .withArgs(DISTRIBUTOR, MANUFACTURER);
    });

    it("transfer to a regulator reverts InvalidRoute", async function () {
      const { sc, mfg, reg } = await loadFixture(deployFixture);
      await expect(sc.connect(mfg).transferCustody(1, reg.address, 10, "X"))
        .to.be.revertedWithCustomError(sc, "InvalidRoute")
        .withArgs(MANUFACTURER, REGULATOR);
    });

    it("registered participant with no supply-chain role reverts InvalidRoute", async function () {
      const { sc, admin, dist } = await loadFixture(deployFixture);
      await expect(sc.connect(admin).transferCustody(1, dist.address, 10, "X"))
        .to.be.revertedWithCustomError(sc, "InvalidRoute")
        .withArgs(ethers.ZeroHash, DISTRIBUTOR);
    });

    it("zero quantity reverts ZeroQuantity", async function () {
      const { sc, mfg, dist } = await loadFixture(deployFixture);
      await expect(sc.connect(mfg).transferCustody(1, dist.address, 0, "X")).to.be.revertedWithCustomError(
        sc,
        "ZeroQuantity"
      );
    });

    it("zero address reverts ZeroAddress", async function () {
      const { sc, mfg } = await loadFixture(deployFixture);
      await expect(sc.connect(mfg).transferCustody(1, ZERO, 10, "X")).to.be.revertedWithCustomError(
        sc,
        "ZeroAddress"
      );
    });

    it("sending to yourself reverts SelfTransfer", async function () {
      const { sc, mfg } = await loadFixture(deployFixture);
      await expect(sc.connect(mfg).transferCustody(1, mfg.address, 10, "X")).to.be.revertedWithCustomError(
        sc,
        "SelfTransfer"
      );
    });

    it("ZeroQuantity is reported before ZeroAddress", async function () {
      const { sc, mfg } = await loadFixture(deployFixture);
      await expect(sc.connect(mfg).transferCustody(1, ZERO, 0, "X")).to.be.revertedWithCustomError(
        sc,
        "ZeroQuantity"
      );
    });

    it("recalled batch reverts BatchIsRecalled", async function () {
      const { sc, inventory, mfg, dist } = await loadFixture(deployFixture);
      await inventory.setRecalled(1, true);
      await expect(sc.connect(mfg).transferCustody(1, dist.address, 10, "X"))
        .to.be.revertedWithCustomError(sc, "BatchIsRecalled")
        .withArgs(1);
    });

    it("expired batch reverts BatchIsExpired", async function () {
      const { sc, inventory, mfg, dist } = await loadFixture(deployFixture);
      await inventory.setExpired(1, true);
      await expect(sc.connect(mfg).transferCustody(1, dist.address, 10, "X"))
        .to.be.revertedWithCustomError(sc, "BatchIsExpired")
        .withArgs(1);
    });

    it("recall is reported before expiry", async function () {
      const { sc, inventory, mfg, dist } = await loadFixture(deployFixture);
      await inventory.setRecalled(1, true);
      await inventory.setExpired(1, true);
      await expect(sc.connect(mfg).transferCustody(1, dist.address, 10, "X")).to.be.revertedWithCustomError(
        sc,
        "BatchIsRecalled"
      );
    });

    it("second transfer to the same recipient while one is pending reverts TransferAlreadyPending", async function () {
      const { sc, mfg, dist } = await loadFixture(deployFixture);
      await sc.connect(mfg).transferCustody(1, dist.address, 100, "Plant");
      await expect(sc.connect(mfg).transferCustody(1, dist.address, 100, "Plant"))
        .to.be.revertedWithCustomError(sc, "TransferAlreadyPending")
        .withArgs(1, dist.address);
    });
  });

  // ------------------------------------------------- recall while in transit

  describe("recall and expiry during transit", function () {
    it("recall while in transit, then accept reverts BatchIsRecalled", async function () {
      const { sc, inventory, mfg, dist } = await loadFixture(deployFixture);
      await sc.connect(mfg).transferCustody(1, dist.address, 400, "Plant");
      await inventory.setRecalled(1, true);
      await expect(sc.connect(dist).acceptConsignment(1))
        .to.be.revertedWithCustomError(sc, "BatchIsRecalled")
        .withArgs(1);
    });

    it("expiry while in transit, then accept reverts BatchIsExpired", async function () {
      const { sc, inventory, mfg, dist } = await loadFixture(deployFixture);
      await sc.connect(mfg).transferCustody(1, dist.address, 400, "Plant");
      await inventory.setExpired(1, true);
      await expect(sc.connect(dist).acceptConsignment(1))
        .to.be.revertedWithCustomError(sc, "BatchIsExpired")
        .withArgs(1);
    });

    it("recall while in transit, then reject succeeds and sender gets stock back", async function () {
      const { sc, scAddr, inventory, mfg, dist } = await loadFixture(deployFixture);
      await sc.connect(mfg).transferCustody(1, dist.address, 400, "Plant");
      await inventory.setRecalled(1, true);

      await expect(sc.connect(dist).rejectConsignment(1, "Batch recalled"))
        .to.emit(sc, "TransferRejected")
        .withArgs(1, mfg.address, dist.address, "Batch recalled");

      expect(await inventory.getFacilityStock(mfg.address, 1)).to.equal(1000n);
      expect(await inventory.getFacilityStock(scAddr, 1)).to.equal(0n);
      expect(await sc.hasPendingTransfer(1, dist.address)).to.equal(false);
      // A rejection is not a handoff, so the trail is unchanged
      expect((await sc.getCustodyHistory(1)).length).to.equal(1);
    });

    it("reject with nothing pending reverts NoPendingTransfer", async function () {
      const { sc, dist } = await loadFixture(deployFixture);
      await expect(sc.connect(dist).rejectConsignment(1, "?"))
        .to.be.revertedWithCustomError(sc, "NoPendingTransfer")
        .withArgs(1, dist.address);
    });
  });

  // ---------------------------------------------------------- cancelTransfer

  describe("cancelTransfer", function () {
    it("sender cancels: stock back, entry gone", async function () {
      const { sc, scAddr, inventory, mfg, dist } = await loadFixture(deployFixture);
      await sc.connect(mfg).transferCustody(1, dist.address, 400, "Plant");

      await expect(sc.connect(mfg).cancelTransfer(1, dist.address))
        .to.emit(sc, "TransferCancelled")
        .withArgs(1, mfg.address, dist.address);

      expect(await inventory.getFacilityStock(mfg.address, 1)).to.equal(1000n);
      expect(await inventory.getFacilityStock(scAddr, 1)).to.equal(0n);
      expect(await sc.hasPendingTransfer(1, dist.address)).to.equal(false);
      const p = await sc.getPendingTransfer(1, dist.address);
      expect(p.from).to.equal(ZERO);
    });

    it("cancel works even on a recalled batch", async function () {
      const { sc, inventory, mfg, dist } = await loadFixture(deployFixture);
      await sc.connect(mfg).transferCustody(1, dist.address, 400, "Plant");
      await inventory.setRecalled(1, true);
      await sc.connect(mfg).cancelTransfer(1, dist.address);
      expect(await inventory.getFacilityStock(mfg.address, 1)).to.equal(1000n);
    });

    it("someone else trying to cancel reverts NoPendingTransfer", async function () {
      const { sc, mfg, dist, stranger } = await loadFixture(deployFixture);
      await sc.connect(mfg).transferCustody(1, dist.address, 400, "Plant");
      await expect(sc.connect(stranger).cancelTransfer(1, dist.address))
        .to.be.revertedWithCustomError(sc, "NoPendingTransfer")
        .withArgs(1, dist.address);
      // The recipient can't cancel either; they reject instead
      await expect(sc.connect(dist).cancelTransfer(1, dist.address)).to.be.revertedWithCustomError(
        sc,
        "NoPendingTransfer"
      );
    });

    it("cancel with nothing pending reverts NoPendingTransfer", async function () {
      const { sc, mfg, dist } = await loadFixture(deployFixture);
      await expect(sc.connect(mfg).cancelTransfer(1, dist.address)).to.be.revertedWithCustomError(
        sc,
        "NoPendingTransfer"
      );
    });

    it("after a cancel, the same recipient can be sent to again", async function () {
      const { sc, mfg, dist } = await loadFixture(deployFixture);
      await sc.connect(mfg).transferCustody(1, dist.address, 400, "Plant");
      await sc.connect(mfg).cancelTransfer(1, dist.address);
      await expect(sc.connect(mfg).transferCustody(1, dist.address, 200, "Plant")).to.emit(
        sc,
        "CustodyTransferInitiated"
      );
    });
  });
});
