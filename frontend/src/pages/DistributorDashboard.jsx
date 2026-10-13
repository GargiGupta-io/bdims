import { useMemo, useState } from "react";
import { useHolderLedger } from "../hooks/useLedger.js";
import { makeNameOf } from "../lib/ledger.js";
import { units } from "../lib/format.js";
import { Button, Card, Stat } from "../components/ui.jsx";
import { DispatchModal, InTransit, IncomingConsignments, StockTable, TrailModal } from "../components/batch.jsx";

// A distributor sits in the middle: accepts stock from manufacturers or other
// distributors, and forwards it to pharmacies or other distributors.
export default function DistributorDashboard({ wallet, profile }) {
  const ledger = useHolderLedger(wallet);
  const [forwarding, setForwarding] = useState(null);
  const [tracing, setTracing] = useState(null);
  const nameOf = makeNameOf(ledger.participants, wallet.deployment.contracts.SupplyChain);

  const totals = useMemo(
    () => ({
      stock: ledger.holdings.reduce((s, b) => s + b.stock, 0n),
      incoming: ledger.incoming.reduce((s, t) => s + t.quantity, 0n),
      outgoing: ledger.outgoing.reduce((s, t) => s + t.quantity, 0n),
    }),
    [ledger.holdings, ledger.incoming, ledger.outgoing]
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <p className="text-sm font-medium text-teal-700">Distributor</p>
        <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
        <p className="text-sm text-slate-500">Licence {profile.licenceId}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Batches held" value={ledger.holdings.length} />
        <Stat label="Units in your stock" value={units(totals.stock)} />
        <Stat label="Awaiting your acceptance" value={units(totals.incoming)} hint={`${ledger.incoming.length} consignment${ledger.incoming.length === 1 ? "" : "s"}`} />
        <Stat label="Units you've sent in transit" value={units(totals.outgoing)} />
      </div>

      {ledger.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">Couldn't load the ledger: {ledger.error}</p>}

      <IncomingConsignments items={ledger.incoming} nameOf={nameOf} supply={wallet.contracts.supply} onDone={ledger.reload} />

      <Card title="Your stock" subtitle="Soonest expiry first. Recalled or expired batches can't be forwarded.">
        {ledger.loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <StockTable
            rows={ledger.holdings}
            nameOf={nameOf}
            actions={(b, status) => (
              <>
                <Button size="sm" variant="secondary" onClick={() => setTracing(b)}>
                  Trail
                </Button>
                <Button size="sm" onClick={() => setForwarding(b)} disabled={status.frozen}>
                  Forward
                </Button>
              </>
            )}
          />
        )}
      </Card>

      <InTransit items={ledger.outgoing} nameOf={nameOf} supply={wallet.contracts.supply} onDone={ledger.reload} />

      {forwarding && (
        <DispatchModal
          batch={forwarding}
          participants={ledger.participants}
          supply={wallet.contracts.supply}
          self={wallet.address}
          verb="Forward"
          onClose={() => setForwarding(null)}
          onDone={ledger.reload}
        />
      )}
      {tracing && <TrailModal batch={tracing} supply={wallet.contracts.supply} nameOf={nameOf} onClose={() => setTracing(null)} />}
    </div>
  );
}
