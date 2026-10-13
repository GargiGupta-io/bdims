// Copies the ABIs of the three frozen interfaces into src/abi/.
// The frontend only ever talks to the interfaces, so it works with any
// implementation of them. Run after `npm run compile` in the repo root,
// only if an interface ever changes.
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..", "..");
const names = ["IDrugRegistry", "ISupplyChain", "IInventoryManager"];

for (const name of names) {
  const artifact = path.join(root, "artifacts", "contracts", "interfaces", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(artifact)) throw new Error(`Missing ${artifact}. Run "npm run compile" in the repo root.`);
  const { abi } = JSON.parse(fs.readFileSync(artifact, "utf8"));
  fs.writeFileSync(path.join(import.meta.dirname, "..", "src", "abi", `${name}.json`), JSON.stringify(abi, null, 2) + "\n");
  console.log(`${name}: ${abi.length} entries`);
}
