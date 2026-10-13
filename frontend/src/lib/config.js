import { JsonRpcProvider } from "ethers";

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

// Read-only access with no wallet, for the public verification page.
// Sepolia uses a free public endpoint, never a private key-bearing URL:
// anything in this file ships to every visitor's browser.
const READ_RPC = {
  [LOCAL_CHAIN_ID]: LOCAL_RPC,
  [SEPOLIA_CHAIN_ID]: import.meta.env.VITE_SEPOLIA_READ_RPC || "https://ethereum-sepolia-rpc.publicnode.com",
};

// The network the public page reads: the live Sepolia deployment once it
// exists, otherwise the local chain.
export const PUBLIC_CHAIN_ID = deployments[SEPOLIA_CHAIN_ID] ? SEPOLIA_CHAIN_ID : LOCAL_CHAIN_ID;

export function readProvider(chainId = PUBLIC_CHAIN_ID) {
  return new JsonRpcProvider(READ_RPC[chainId], chainId, { staticNetwork: true });
}
