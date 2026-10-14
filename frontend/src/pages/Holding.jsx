import { Button, Card } from "../components/ui.jsx";
import { NETWORKS, deployments, LOCAL_CHAIN_ID, SEPOLIA_CHAIN_ID } from "../lib/config.js";
import { shortAddr } from "../lib/format.js";

export function NotRegistered({ address, revokedName }) {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
      {revokedName ? (
        <Card title="Access revoked" subtitle={`${revokedName} · ${shortAddr(address)}`}>
          <p className="text-slate-600">
            The admin has revoked this account. It can no longer act on the ledger, but everything it did before stays on record. Contact the admin if this is a mistake.
          </p>
        </Card>
      ) : (
        <Card title="This wallet isn't registered" subtitle={shortAddr(address)}>
          <p className="text-slate-600">
            Only participants onboarded by the admin can act on the ledger. Send this address to the admin to be registered as a manufacturer, distributor, pharmacy or regulator.
          </p>
          <p className="mt-3 break-all rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700">{address}</p>
        </Card>
      )}
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
