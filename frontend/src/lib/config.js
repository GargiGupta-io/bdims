// Networks the app knows, and where each one's contracts live.
// Addresses come from ../deployments/<network>.json, written by the deploy
// script, so nothing here changes when contracts are redeployed.

const manifests = import.meta.glob("../../../deployments/*.json", { eager: true, import: "default" });

export const deployments = {};
for (const [file, m] of Object.entries(manifests)) {
  // hardhat.json comes from a throwaway in-process run; localhost.json is the real local chain.
  if (!m?.contracts || !m?.chainId || file.endsWith("/hardhat.json")) continue;
  deployments[m.chainId] = m;
}

export const LOCAL_CHAIN_ID = 31337;
export const SEPOLIA_CHAIN_ID = 11155111;
export const LOCAL_RPC = "http://127.0.0.1:8545";

export const NETWORKS = {
  [LOCAL_CHAIN_ID]: { name: "Local Hardhat", short: "Local" },
  [SEPOLIA_CHAIN_ID]: { name: "Ethereum Sepolia", short: "Sepolia" },
};

export const hasLocalDeployment = Boolean(deployments[LOCAL_CHAIN_ID]);
