// Proves your laptop is set up correctly. If these three pass, you're ready.
const { expect } = require("chai");
const hre = require("hardhat");

describe("Setup", function () {
  it("runs on the local Hardhat network", async function () {
    expect(hre.network.name).to.equal("hardhat");
  });

  it("has funded test accounts (no faucet needed)", async function () {
    const signers = await hre.ethers.getSigners();
    expect(signers.length).to.equal(20);
    const balance = await hre.ethers.provider.getBalance(signers[0].address);
    expect(balance).to.equal(hre.ethers.parseEther("10000"));
  });

  it("compiles all three shared interfaces", async function () {
    for (const name of ["IDrugRegistry", "ISupplyChain", "IInventoryManager"]) {
      const artifact = await hre.artifacts.readArtifact(name);
      expect(artifact.abi.length).to.be.greaterThan(0);
    }
  });
});
