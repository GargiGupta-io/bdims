import { useEffect, useState } from "react";
import { JsonRpcProvider } from "ethers";
import { deployments, hasLocalDeployment, LOCAL_CHAIN_ID, LOCAL_RPC } from "../lib/config.js";
import { getContracts } from "../lib/contracts.js";
import { roleLabel } from "../lib/roles.js";
import { shortAddr } from "../lib/format.js";
import { Button, Card } from "./ui.jsx";

// Local test accounts 0 to 9, labelled with who the registry says they are.
// 0 to 5 are seeded; 6 to 9 are spares for the admin to onboard during a demo.
function useLocalAccounts() {
  const [accounts, setAccounts] = useState([]);
  useEffect(() => {
    if (!hasLocalDeployment) return;
    (async () => {
      try {
        const provider = new JsonRpcProvider(LOCAL_RPC, LOCAL_CHAIN_ID, { staticNetwork: true });
        const { registry } = getContracts(deployments[LOCAL_CHAIN_ID], provider);
        const addresses = (await provider.send("eth_accounts", [])).slice(0, 10);
        const rows = await Promise.all(
          addresses.map(async (address, index) => {
            const [p, admin] = await Promise.all([registry.getParticipant(address), registry.hasRole("0x" + "0".repeat(64), address)]);
            return { index, address, label: p.active ? `${p.name} · ${roleLabel(p.role)}` : admin ? "Admin (deployer)" : p.name ? `${p.name} · Revoked` : "Not registered" };
          })
        );
        setAccounts(rows);
      } catch {
        setAccounts([]);
      }
    })();
  }, []);
  return accounts;
}

export default function ConnectScreen({ wallet }) {
  const localAccounts = useLocalAccounts();
  const [pick, setPick] = useState(1);

  return (
    <div className="mx-auto max-w-xl px-4 py-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">Every batch, every handoff, on one ledger.</h1>
      <p className="mt-2 text-slate-600">
        Manufacturers, distributors, pharmacies and regulators share one tamper-proof record of where each drug batch has been and who holds it now.
      </p>

      <a href="#/verify" className="mt-6 flex items-center justify-between rounded-xl border border-teal-200 bg-teal-50 px-5 py-4 text-teal-900 hover:bg-teal-100">
        <span>
          <span className="block font-medium">Checking a medicine?</span>
          <span className="block text-sm">Verify any batch without a wallet.</span>
        </span>
        <span aria-hidden>→</span>
      </a>

      <Card className="mt-6" title="Connect your wallet" subtitle="Your wallet address is your identity. The registry decides what you can do.">
        <Button onClick={wallet.connectMetaMask} disabled={wallet.status === "connecting"} className="w-full">
          {wallet.status === "connecting" ? "Waiting for MetaMask…" : "Connect MetaMask"}
        </Button>

        {localAccounts.length > 0 && (
          <div className="mt-6 border-t border-slate-100 pt-5">
            <p className="text-sm font-medium text-slate-700">Development: act as a local test account</p>
            <p className="mt-0.5 text-xs text-slate-500">Only on the local Hardhat chain. No wallet needed.</p>
            <div className="mt-3 flex gap-2">
              <select value={pick} onChange={(e) => setPick(Number(e.target.value))} className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" aria-label="Local test account">
                {localAccounts.map((a) => (
                  <option key={a.index} value={a.index}>
                    #{a.index} {a.label} ({shortAddr(a.address)})
                  </option>
                ))}
              </select>
              <Button variant="secondary" onClick={() => wallet.connectLocal(pick)}>
                Use account
              </Button>
            </div>
          </div>
        )}

        {wallet.error && <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{wallet.error}</p>}
      </Card>
    </div>
  );
}
