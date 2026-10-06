// Deploys the three BDIMS contracts and wires them together.
//
//   Local:    npx hardhat node          (terminal 1, leave running)
//             npm run deploy:local      (terminal 2)
//
//   Sepolia:  fill in .env, then
//             npm run deploy:sepolia
//
// Order matters. SupplyChain needs the registry's address, InventoryManager
// needs both, and then the registry and SupplyChain are told where the
// others live. This won't run until all three contracts exist.

const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const { ethers, network } = hre;
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);

  console.log(`Network:  ${network.name}`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  // 1. Registry first. No dependencies. Deployer becomes the admin.
  const registry = await ethers.deployContract("DrugRegistry", [deployer.address]);
  await registry.waitForDeployment();
  const registryAddr = await registry.getAddress();
  console.log(`DrugRegistry      ${registryAddr}`);

  // 2. SupplyChain reads the registry.
  const supplyChain = await ethers.deployContract("SupplyChain", [registryAddr]);
  await supplyChain.waitForDeployment();
  const supplyChainAddr = await supplyChain.getAddress();
  console.log(`SupplyChain       ${supplyChainAddr}`);

  // 3. InventoryManager reads both.
  const inventory = await ethers.deployContract("InventoryManager", [registryAddr, supplyChainAddr]);
  await inventory.waitForDeployment();
  const inventoryAddr = await inventory.getAddress();
  console.log(`InventoryManager  ${inventoryAddr}`);

  // 4. Close the loop.
  await (await registry.setSupplyChain(supplyChainAddr)).wait();
  await (await registry.setInventoryManager(inventoryAddr)).wait();
  await (await supplyChain.setInventoryManager(inventoryAddr)).wait();
  console.log("\nWired.");

  // 5. Manifest for the frontend.
  const { chainId } = await ethers.provider.getNetwork();
  const manifest = {
    network: network.name,
    chainId: Number(chainId),
    deployedAt: new Date().toISOString(),
    deployer: deployer.address,
    contracts: {
      DrugRegistry: registryAddr,
      SupplyChain: supplyChainAddr,
      InventoryManager: inventoryAddr,
    },
  };
  const out = path.join(__dirname, "..", "deployments", `${network.name}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`Manifest written to deployments/${network.name}.json`);

  if (network.name === "sepolia") {
    console.log("\nVerify on Etherscan (wait ~1 minute first):");
    console.log(`  npx hardhat verify --network sepolia ${registryAddr} ${deployer.address}`);
    console.log(`  npx hardhat verify --network sepolia ${supplyChainAddr} ${registryAddr}`);
    console.log(`  npx hardhat verify --network sepolia ${inventoryAddr} ${registryAddr} ${supplyChainAddr}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
