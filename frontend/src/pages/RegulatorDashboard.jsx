import { useMemo, useState } from "react";
import { useNetworkLedger } from "../hooks/useLedger.js";
import { batchStatus, makeNameOf } from "../lib/ledger.js";
import { roleLabel } from "../lib/roles.js";
import { shortAddr, toDate, units } from "../lib/format.js";
import { Badge, Button, Card, Modal, Stat, inputClass } from "../components/ui.jsx";
import { RecallModal, TrailModal } from "../components/batch.jsx";

const FILTERS = ["All", "Active", "Expiring", "Expired", "Recalled"];

// The regulator sees the whole network: every batch, every holder, every
// recall, and can recall any batch, not just their own.
export default function RegulatorDashboard({ wallet, profile }) {
  const ledger = useNetworkLedger(wallet);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [recalling, setRecalling] = useState(null);
  const [tracing, setTracing] = useState(null);
  const [holding, setHolding] = useState(null);

  const escrow = wallet.deployment.contracts.SupplyChain;
  const nameOf = useMemo(() => makeNameOf(ledger.participants, escrow), [ledger.participants, escrow]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    return ledger.batches
      .map((b) => ({ ...b, status: batchStatus(b) }))
      .filter((b) => {
        if (filter === "Recalled" && !b.recalled) return false;
        if (filter === "Expired" && (b.recalled || b.status.label !== "Expired")) return false;
        if (filter === "Expiring" && b.status.tone !== "amber") return false;
        if (filter === "Active" && b.status.tone !== "green") return false;
        if (!q) return true;
        return b.id.toString() === q || b.drugName.toLowerCase().includes(q) || nameOf(b.manufacturer).toLowerCase().includes(q);
      });
  }, [ledger.batches, query, filter, nameOf]);

  // Units of a recalled or expired batch still sitting somewhere in the chain.
  const attention = ledger.batches.filter((b) => batchStatus(b).frozen && b.unitsOut > 0n);
  const active = Object.values(ledger.participants).filter((p) => p.active).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <p className="text-sm font-medium text-teal-700">Regulator</p>
        <h1 className="text-2xl font-semibold tracking-tight">{profile.name}</h1>
        <p className="text-sm text-slate-500">Licence {profile.licenceId}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Batches on the network" value={ledger.batches.length} />
        <Stat label="Active participants" value={active} />
        <Stat label="Recalls issued" value={ledger.recalls.length} />
        <Stat label="Unsafe stock still held" value={attention.length} hint="Recalled or expired batches with units left" />
      </div>

      {ledger.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">Couldn't load the ledger: {ledger.error}</p>}

      {attention.length > 0 && (
        <Card title="Needs follow-up" subtitle="Frozen on chain, but the physical units are still out there.">
          <ul className="divide-y divide-slate-100">
            {attention.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium">
                    Batch #{b.id.toString()} · {b.drugName} <Badge tone="red">{batchStatus(b).label}</Badge>
                  </p>
                  <p className="text-xs text-slate-500">
                    {units(b.unitsOut)} units at {b.holdings.filter((h) => h.stock > 0n).map((h) => nameOf(h.address)).join(", ")}
                  </p>
                </div>
                <Button size="sm" variant="secondary" onClick={() => setHolding(b)}>
                  Holders
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card
        title="All batches"
        subtitle="Search by batch number, drug or manufacturer."
        action={
          <div className="flex flex-wrap gap-1">
            {FILTERS.map((f) => (
              <Button key={f} size="sm" variant={filter === f ? "primary" : "ghost"} onClick={() => setFilter(f)}>
                {f}
              </Button>
            ))}
          </div>
        }
      >
        <input className={`${inputClass} mb-4`} value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: 3, Insulin, Cipla…" aria-label="Search batches" />
        {ledger.loading ? (
          <p className="text-sm text-slate-500">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No batches match.</p>
        ) : (
          <div className="-mx-5 -mb-5 overflow-x-auto border-t border-slate-100">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-5 py-3 font-medium">Batch</th>
                  <th className="px-3 py-3 font-medium">Drug</th>
                  <th className="whitespace-nowrap px-3 py-3 text-right font-medium">Units held</th>
                  <th className="px-3 py-3 font-medium">Expiry</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-5 py-3 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((b) => (
                  <tr key={b.id} className="align-top">
                    <td className="px-5 py-3 font-mono text-xs text-slate-600">#{b.id.toString()}</td>
                    <td className="px-3 py-3">
                      <p className="font-medium">{b.drugName}</p>
                      <p className="text-xs text-slate-500">
                        {nameOf(b.manufacturer)} · {units(b.quantity)} produced
                      </p>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{units(b.unitsOut)}</td>
                    <td className="whitespace-nowrap px-3 py-3">{toDate(b.expiryDate)}</td>
                    <td className="px-3 py-3">
                      <Badge tone={b.status.tone}>{b.status.label}</Badge>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="secondary" onClick={() => setHolding(b)}>
                          Holders
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setTracing(b)}>
                          Trail
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setRecalling(b)} disabled={b.recalled}>
                          Recall
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card title="Recall history" subtitle="Who recalled what, and why. Permanent.">
          {ledger.recalls.length === 0 ? (
            <p className="text-sm text-slate-500">No recalls yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {ledger.recalls.map((r) => (
                <li key={r.batchId} className="py-3 text-sm">
                  <p className="font-medium">
                    Batch #{r.batchId.toString()} · {ledger.batches.find((b) => b.id === r.batchId)?.drugName}
                  </p>
                  <p className="text-xs text-slate-500">
                    "{r.reason}" · by {nameOf(r.by)} · {toDate(r.timestamp)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Participants" subtitle="Everyone the admin has onboarded.">
          <ul className="divide-y divide-slate-100">
            {Object.values(ledger.participants).map((p) => (
              <li key={p.address} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                <div>
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-slate-500">
                    {p.licenceId} · {shortAddr(p.address)}
                  </p>
                </div>
                {p.active ? <Badge tone="teal">{roleLabel(p.role)}</Badge> : <Badge tone="slate">Revoked</Badge>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {recalling && <RecallModal batch={recalling} inventory={wallet.contracts.inventory} nameOf={nameOf} onClose={() => setRecalling(null)} onDone={ledger.reload} />}
      {tracing && <TrailModal batch={tracing} supply={wallet.contracts.supply} nameOf={nameOf} onClose={() => setTracing(null)} />}
      {holding && <HoldersModal batch={holding} nameOf={nameOf} onClose={() => setHolding(null)} />}
    </div>
  );
}

// Who holds how many units of one batch right now. These are the
// facilities to contact in a recall.
function HoldersModal({ batch, nameOf, onClose }) {
  const held = batch.holdings.filter((h) => h.stock > 0n);
  return (
    <Modal title={`Holders · batch #${batch.id} · ${batch.drugName}`} onClose={onClose}>
      {held.length === 0 ? (
        <p className="text-sm text-slate-500">Nobody holds any units. Everything has been dispensed.</p>
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {held.map((h) => (
            <li key={h.address} className="flex justify-between gap-3 py-2">
              <span>{nameOf(h.address)}</span>
              <span className="tabular-nums">{units(h.stock)} units</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
