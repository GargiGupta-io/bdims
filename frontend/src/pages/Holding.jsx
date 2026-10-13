import { Button, Card } from "../components/ui.jsx";
import { NETWORKS, deployments, LOCAL_CHAIN_ID, SEPOLIA_CHAIN_ID } from "../lib/config.js";
import { shortAddr } from "../lib/format.js";

const NEXT = {
  Distributor: "Accept incoming consignments, see your stock per batch, and forward it to pharmacies or other distributors.",
  Pharmacy: "Receive stock, dispense to patients with automatic expiry and recall checks, and get warnings before batches expire.",
  Regulator: "Search every batch and participant, read full custody trails, and recall any batch network-wide.",
  Admin: "Onboard manufacturers, distributors, pharmacies and regulators, and change or revoke their roles.",
};

export function ComingSoon({ role }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <Card title={`${role} dashboard`} subtitle="Coming next">
        <p className="text-slate-600">{NEXT[role]}</p>
        <p className="mt-3 text-sm text-slate-500">The manufacturer dashboard is built first. Switch to a manufacturer account to try it.</p>
      </Card>
    </div>
  );
}

export function NotRegistered({ address }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <Card title="This wallet isn't registered" subtitle={shortAddr(address)}>
        <p className="text-slate-600">
          Only participants onboarded by the admin can act on the ledger. Send this address to the admin to be registered as a manufacturer, distributor, pharmacy or regulator.
        </p>
        <p className="mt-3 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">{address}</p>
      </Card>
    </div>
  );
}

export function WrongNetwork({ wallet }) {
  const available = [LOCAL_CHAIN_ID, SEPOLIA_CHAIN_ID].filter((id) => deployments[id]);
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      <Card title="Wrong network" subtitle={`Your wallet is on chain ${wallet.chainId}.`}>
        {available.length === 0 ? (
          <p className="text-slate-600">The contracts aren't deployed on any network yet. Deploy them first (npm run deploy:local).</p>
        ) : (
          <>
            <p className="text-slate-600">The BDIMS contracts are deployed on:</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {available.map((id) => (
                <Button key={id} onClick={() => wallet.switchChain(id)} disabled={wallet.mode !== "metamask"}>
                  Switch to {NETWORKS[id].name}
                </Button>
              ))}
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
