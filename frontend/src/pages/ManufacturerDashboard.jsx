import { useMemo, useState } from "react";
import { useManufacturerLedger } from "../hooks/useLedger.js";
import { batchStatus, makeNameOf } from "../lib/ledger.js";
import { useTx } from "../hooks/useTx.js";
import { dateInputToSeconds, toDate, todayInput, units } from "../lib/format.js";
import { Badge, Button, Card, Field, Stat, TxStatus, inputClass } from "../components/ui.jsx";
import { DispatchModal, InTransit, RecallModal, TrailModal } from "../components/batch.jsx";
import CertificateField from "../components/CertificateField.jsx";

export default function ManufacturerDashboard({ wallet, profile }) {
  const ledger = useManufacturerLedger(wallet);
  const [dispatching, setDispatching] = useState(null);
  const [recalling, setRecalling] = useState(null);
  const [tracing, setTracing] = useState(null);

  const nameOf = makeNameOf(ledger.participants, wallet.deployment.contracts.SupplyChain);

  const totals = useMemo(() => {
    const inStock = ledger.batches.reduce((s, b) => s + b.stock, 0n);
    const inTransit = ledger.inTransit.reduce((s, t) => s + t.quantity, 0n);
    return { inStock, inTransit, recalled: ledger.batches.filter((b) => b.recalled).length };
  }, [ledger.batches, ledger.inTransit]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <p className="text-sm font-medium text-teal-700">Manufacturer</p>
        <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
        <p className="text-sm text-slate-500">Licence {profile.licenceId}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Batches registered" value={ledger.batches.length} />
        <Stat label="Units in your stock" value={units(totals.inStock)} />
        <Stat label="Units in transit" value={units(totals.inTransit)} hint="Dispatched, not yet accepted" />
        <Stat label="Recalled batches" value={totals.recalled} />
      </div>

      {ledger.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">Couldn't load the ledger: {ledger.error}</p>}

      <Card title="Your batches" subtitle="Live from the chain. Updates on every new block.">
        {ledger.loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : ledger.batches.length === 0 ? (
          <p className="text-sm text-slate-500">No batches yet. Register your first one below.</p>
        ) : (
          <BatchTable batches={ledger.batches} onDispatch={setDispatching} onRecall={setRecalling} onTrace={setTracing} />
        )}
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <RegisterBatch registry={wallet.contracts.registry} onDone={ledger.reload} />
        <InTransit items={ledger.inTransit} nameOf={nameOf} supply={wallet.contracts.supply} onDone={ledger.reload} />
      </div>

      {dispatching && (
        <DispatchModal batch={dispatching} participants={ledger.participants} supply={wallet.contracts.supply} self={wallet.address} onClose={() => setDispatching(null)} onDone={ledger.reload} />
      )}
      {recalling && <RecallModal batch={recalling} inventory={wallet.contracts.inventory} nameOf={nameOf} onClose={() => setRecalling(null)} onDone={ledger.reload} />}
      {tracing && <TrailModal batch={tracing} supply={wallet.contracts.supply} nameOf={nameOf} onClose={() => setTracing(null)} />}
    </div>
  );
}

function RegisterBatch({ registry, onDone }) {
  const blank = { drugName: "", composition: "", mfgDate: todayInput(), expiryDate: "", quantity: "", ipfsHash: "" };
  const [form, setForm] = useState(blank);
  const tx = useTx(() => {
    setForm(blank);
    onDone();
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = (e) => {
    e.preventDefault();
    tx.run("Register batch", () =>
      registry.registerBatch(
        form.drugName.trim(),
        form.composition.trim(),
        dateInputToSeconds(form.mfgDate),
        dateInputToSeconds(form.expiryDate),
        BigInt(form.quantity || 0),
        form.ipfsHash.trim()
      )
    );
  };

  return (
    <Card title="Register a batch" subtitle="Gives the batch its permanent on-chain identity.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Drug name">
          <input className={inputClass} value={form.drugName} onChange={set("drugName")} placeholder="Paracetamol 500mg" required />
        </Field>
        <Field label="Composition">
          <input className={inputClass} value={form.composition} onChange={set("composition")} placeholder="Paracetamol IP 500 mg" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Manufactured">
            <input type="date" className={inputClass} value={form.mfgDate} onChange={set("mfgDate")} required />
          </Field>
          <Field label="Expires">
            <input type="date" className={inputClass} value={form.expiryDate} min={todayInput()} onChange={set("expiryDate")} required />
          </Field>
        </div>
        <Field label="Quantity (units)">
          <input type="number" min="1" step="1" className={inputClass} value={form.quantity} onChange={set("quantity")} placeholder="10000" required />
        </Field>
        <CertificateField value={form.ipfsHash} onChange={(cid) => setForm((f) => ({ ...f, ipfsHash: cid }))} />
        <Button type="submit" disabled={tx.busy || !form.ipfsHash.trim()} className="w-full">
          {tx.busy ? "Registering…" : "Register batch"}
        </Button>
        <TxStatus state={tx.state} />
      </form>
    </Card>
  );
}

function BatchTable({ batches, onDispatch, onRecall, onTrace }) {
  return (
    <div className="-mx-5 -my-5 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="px-5 py-3 font-medium">Batch</th>
            <th className="px-3 py-3 font-medium">Drug</th>
            <th className="whitespace-nowrap px-3 py-3 text-right font-medium">In stock</th>
            <th className="px-3 py-3 font-medium">Expiry</th>
            <th className="px-3 py-3 font-medium">Status</th>
            <th className="px-5 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {batches.map((b) => {
            const status = batchStatus(b);
            return (
              <tr key={b.id} className="align-top">
                <td className="px-5 py-3 font-mono text-xs text-slate-600">#{b.id.toString()}</td>
                <td className="px-3 py-3">
                  <p className="font-medium">{b.drugName}</p>
                  <p className="text-xs text-slate-500">
                    {units(b.quantity)} produced · {b.holders.length} holder{b.holders.length === 1 ? "" : "s"}
                  </p>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{units(b.stock)}</td>
                <td className="px-3 py-3 whitespace-nowrap">{toDate(b.expiryDate)}</td>
                <td className="px-3 py-3">
                  <Badge tone={status.tone}>{status.label}</Badge>
                </td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-1.5">
                    <Button size="sm" variant="secondary" onClick={() => onTrace(b)}>
                      Trail
                    </Button>
                    <Button size="sm" onClick={() => onDispatch(b)} disabled={status.frozen || b.stock === 0n}>
                      Dispatch
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => onRecall(b)} disabled={b.recalled}>
                      Recall
                    </Button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
