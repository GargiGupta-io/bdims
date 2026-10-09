// Deploys the temporary probe pair onto the local Hardhat node and wires it,
// exactly the way scripts/deploy.js will do for the real contracts.
// Run by setup.js; you don't need to run it yourself.

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();

  const registry = await ethers.deployContract("ProbeRegistry", [deployer.address]);
  await registry.waitForDeployment();
  const ledger = await ethers.deployContract("ProbeLedger", [await registry.getAddress()]);
  await ledger.waitForDeployment();
  await (await registry.setLedger(await ledger.getAddress())).wait();

  const manifest = {
    network: network.name,
    contracts: {
      ProbeRegistry: await registry.getAddress(),
      ProbeLedger: await ledger.getAddress(),
    },
  };
  const out = path.join(hre.config.paths.root, "deployments", `${network.name}-probe.json`);
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Probe deployed: ${JSON.stringify(manifest.contracts)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
