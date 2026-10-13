import { Contract, Interface } from "ethers";
import IDrugRegistry from "../abi/IDrugRegistry.json";
import ISupplyChain from "../abi/ISupplyChain.json";
import IInventoryManager from "../abi/IInventoryManager.json";

export const ABIS = { IDrugRegistry, ISupplyChain, IInventoryManager };

// One contract object per contract, talking through the interface ABIs.
export function getContracts(deployment, runner) {
  const c = deployment.contracts;
  return {
    registry: new Contract(c.DrugRegistry, IDrugRegistry, runner),
    supply: new Contract(c.SupplyChain, ISupplyChain, runner),
    inventory: new Contract(c.InventoryManager, IInventoryManager, runner),
  };
}

// Every custom error across all three contracts. A revert raised inside one
// contract can surface through a call to another, so decode against all.
export const allErrors = new Interface([
  ...IDrugRegistry.filter((x) => x.type === "error"),
  ...ISupplyChain.filter((x) => x.type === "error"),
  ...IInventoryManager.filter((x) => x.type === "error"),
]);

// Reads every matching event from the deployment block onward. Public RPCs
// cap how many blocks one log query may span, so long ranges go in chunks.
export async function queryAll(contract, filter, fromBlock = 0, chunk = 9000) {
  const latest = await contract.runner.provider.getBlockNumber();
  const out = [];
  for (let start = fromBlock; start <= latest; start += chunk + 1) {
    const end = Math.min(start + chunk, latest);
    out.push(...(await contract.queryFilter(filter, start, end)));
  }
  return out;
}
