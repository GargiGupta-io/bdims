import { useMemo, useState } from "react";
import { useHolderLedger } from "../hooks/useLedger.js";
import { EXPIRY_WARNING_DAYS, makeNameOf } from "../lib/ledger.js";
import { daysUntil, toDate, units } from "../lib/format.js";
import { Button, Card, Stat } from "../components/ui.jsx";
import { IncomingConsignments, StockTable, TrailModal } from "../components/batch.jsx";
import { DispenseModal, ReorderModal } from "../components/pharmacy.jsx";

// The last stop: medicine leaves the ledger here, into a patient's hands.
// The contract refuses to dispense anything expired or recalled.
export default function PharmacyDashboard({ wallet, profile }) {
  const ledger = useHolderLedger(wallet);
  const [dispensing, setDispensing] = useState(null);
  const [reorder, setReorder] = useState(null);
  const [tracing, setTracing] = useState(null);
  const nameOf = makeNameOf(ledger.participants, wallet.deployment.contracts.SupplyChain);

  const alerts = useMemo(() => {
    const out = [];
    for (const b of ledger.holdings) {
      const days = daysUntil(b.expiryDate);
      if (b.recalled) out.push({ b, tone: "red", text: `Recalled. Do not dispense. Return the ${units(b.stock)} units to the manufacturer.` });
      else if (days <= 0) out.push({ b, tone: "red", text: `Expired on ${toDate(b.expiryDate)}. It can no longer be dispensed.` });
      else if (days <= EXPIRY_WARNING_DAYS) out.push({ b, tone: "amber", text: `Expires in ${days} days. Dispense it before newer stock.` });
      if (!b.recalled && b.threshold > 0n && b.stock < b.threshold) out.push({ b, tone: "amber", text: `Low stock: ${units(b.stock)} left, reorder level ${units(b.threshold)}.` });
    }
    return out;
  }, [ledger.holdings]);

  const totals = useMemo(
    () => ({
      stock: ledger.holdings.reduce((s, b) => s + b.stock, 0n),
      dispensed: ledger.dispensed.reduce((s, d) => s + d.quantity, 0n),
    }),
    [ledger.holdings, ledger.dispensed]
  );

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <p className="text-sm font-medium text-teal-700">Pharmacy</p>
        <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
        <p className="text-sm text-slate-500">Licence {profile.licenceId}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Batches on your shelf" value={ledger.holdings.length} />
        <Stat label="Units in stock" value={units(totals.stock)} />
        <Stat label="Need attention" value={alerts.length} hint="Recalled, expiring or low" />
        <Stat label="Units dispensed" value={units(totals.dispensed)} />
      </div>

      {ledger.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">Couldn't load the ledger: {ledger.error}</p>}

      {alerts.length > 0 && (
        <Card title="Needs attention" subtitle="Read from the chain, not from labels.">
          <ul className="space-y-2">
            {alerts.map(({ b, tone, text }, i) => (
              <li key={i} className={`rounded-lg px-3 py-2 text-sm ${tone === "red" ? "bg-rose-50 text-rose-900" : "bg-amber-50 text-amber-900"}`}>
                <span className="font-medium">
                  {b.drugName} (batch #{b.id.toString()}):
                </span>{" "}
                {text}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <IncomingConsignments items={ledger.incoming} nameOf={nameOf} supply={wallet.contracts.supply} onDone={ledger.reload} />

      <Card title="Your shelf" subtitle="Soonest expiry first. Dispensing is refused for recalled or expired batches.">
        {ledger.loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : (
          <StockTable
            rows={ledger.holdings}
            nameOf={nameOf}
            empty="Nothing on your shelf yet. Accept an incoming consignment."
            actions={(b, status) => (
              <>
                <Button size="sm" variant="secondary" onClick={() => setTracing(b)}>
                  Trail
                </Button>
                <Button size="sm" variant="secondary" onClick={() => setReorder(b)}>
                  Reorder level
                </Button>
                <Button size="sm" onClick={() => setDispensing(b)} disabled={status.frozen}>
                  Dispense
                </Button>
              </>
            )}
          />
        )}
      </Card>

      <Card title="Recently dispensed" subtitle="Every dispense is a signed transaction in the audit trail.">
        {ledger.dispensed.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing dispensed yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {ledger.dispensed.slice(0, 10).map((d, i) => (
              <li key={i} className="flex justify-between gap-3 py-2.5 text-sm">
                <span>
                  {d.drugName} <span className="text-slate-500">· batch #{d.batchId.toString()}</span>
                </span>
                <span className="tabular-nums text-slate-600">
                  {units(d.quantity)} units · {toDate(d.timestamp)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dispensing && <DispenseModal batch={dispensing} inventory={wallet.contracts.inventory} onClose={() => setDispensing(null)} onDone={ledger.reload} />}
      {reorder && <ReorderModal batch={reorder} inventory={wallet.contracts.inventory} onClose={() => setReorder(null)} onDone={ledger.reload} />}
      {tracing && <TrailModal batch={tracing} supply={wallet.contracts.supply} nameOf={nameOf} onClose={() => setTracing(null)} />}
    </div>
  );
}
