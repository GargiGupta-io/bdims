import { useEffect, useState } from "react";
import { useTx } from "../hooks/useTx.js";
import { ROLES, roleLabel } from "../lib/roles.js";
import { shortAddr, toDate, units } from "../lib/format.js";
import { Badge, Button, Card, Field, Modal, TxStatus, inputClass } from "./ui.jsx";
import { batchStatus } from "../lib/ledger.js";

// Batch pieces shared by the manufacturer, distributor and pharmacy dashboards.

export function InTransit({ items, nameOf, supply, onDone }) {
  const tx = useTx(onDone);
  return (
    <Card title="In transit" subtitle="Dispatched consignments the recipient hasn't accepted yet. Cancel returns the stock to you.">
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing in transit.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((t) => (
            <li key={`${t.batchId}-${t.to}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="text-sm">
                <p className="font-medium">
                  Batch #{t.batchId.toString()} · {units(t.quantity)} units → {nameOf(t.to)}
                </p>
                <p className="text-xs text-slate-500">
                  {t.location} · sent {toDate(t.initiatedAt)}
                </p>
              </div>
              <Button size="sm" variant="secondary" disabled={tx.busy} onClick={() => tx.run(`Cancel batch #${t.batchId}`, () => supply.cancelTransfer(t.batchId, t.to))}>
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      )}
      <TxStatus state={tx.state} />
    </Card>
  );
}

export function DispatchModal({ batch, participants, supply, self, verb = "Dispatch", onClose, onDone }) {
  const recipients = Object.values(participants).filter(
    (p) => p.active && (p.role === ROLES.DISTRIBUTOR || p.role === ROLES.PHARMACY) && p.address.toLowerCase() !== self?.toLowerCase()
  );
  const [to, setTo] = useState(recipients[0]?.address ?? "");
  const [quantity, setQuantity] = useState("");
  const [location, setLocation] = useState("");
  const tx = useTx(() => {
    onDone();
    setTimeout(onClose, 900);
  });

  const submit = (e) => {
    e.preventDefault();
    tx.run(verb, () => supply.transferCustody(batch.id, to, BigInt(quantity || 0), location.trim()));
  };

  return (
    <Modal title={`${verb} batch #${batch.id} · ${batch.drugName}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Recipient" hint="Stock can only go to a registered distributor or pharmacy.">
          <select className={inputClass} value={to} onChange={(e) => setTo(e.target.value)} required>
            {recipients.map((p) => (
              <option key={p.address} value={p.address}>
                {p.name} · {roleLabel(p.role)} ({shortAddr(p.address)})
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity" hint={`You hold ${units(batch.stock)} units.`}>
          <input type="number" min="1" max={batch.stock.toString()} step="1" className={inputClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} required />
        </Field>
        <Field label="Route / location">
          <input className={inputClass} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Goa plant to Bengaluru hub" required />
        </Field>
        <p className="text-xs text-slate-500">The units leave your stock now and wait in escrow until the recipient accepts.</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button type="submit" disabled={tx.busy || !to}>
            {tx.busy ? "Sending…" : verb}
          </Button>
        </div>
        <TxStatus state={tx.state} />
      </form>
    </Modal>
  );
}

export function TrailModal({ batch, supply, nameOf, onClose }) {
  const [trail, setTrail] = useState(null);
  useEffect(() => {
    let live = true;
    supply.getCustodyHistory(batch.id).then((t) => live && setTrail([...t])).catch(() => live && setTrail([]));
    return () => { live = false; };
  }, [batch.id, supply]);

  return (
    <Modal title={`Custody trail · batch #${batch.id}`} onClose={onClose}>
      {!trail ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <ol className="relative space-y-4 border-l border-slate-200 pl-5">
          {trail.map((r, i) => (
            <li key={i} className="text-sm">
              <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-teal-600" />
              <p className="font-medium">{i === 0 ? `Manufactured by ${nameOf(r.to)}` : `${nameOf(r.from)} → ${nameOf(r.to)}`}</p>
              <p className="text-xs text-slate-500">
                {units(r.quantity)} units · {r.location} · {toDate(r.timestamp)}
              </p>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-4 text-xs text-slate-500">Every entry is a confirmed, signed transaction. None can be edited or deleted.</p>
    </Modal>
  );
}

// Consignments sent to me that I haven't accepted or rejected yet.
// Accepting confirms physical receipt and moves the units into my stock.
// Rejecting returns them to the sender and always works, even on a recalled batch.
export function IncomingConsignments({ items, nameOf, supply, onDone }) {
  const tx = useTx(onDone);
  const [rejecting, setRejecting] = useState(null);
  return (
    <Card title="Incoming consignments" subtitle="Accept once the goods physically arrive. Reject sends them back to the sender.">
      {items.length === 0 ? (
        <p className="text-sm text-slate-500">Nothing waiting for you.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((t) => (
            <li key={`${t.batchId}-${t.from}`} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="text-sm">
                <p className="font-medium">
                  Batch #{t.batchId.toString()} · {units(t.quantity)} units from {nameOf(t.from)}
                </p>
                <p className="text-xs text-slate-500">
                  {t.location} · sent {toDate(t.initiatedAt)}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Button size="sm" variant="secondary" disabled={tx.busy} onClick={() => setRejecting(t)}>
                  Reject
                </Button>
                <Button size="sm" disabled={tx.busy} onClick={() => tx.run(`Accept batch #${t.batchId}`, () => supply.acceptConsignment(t.batchId))}>
                  Accept
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <TxStatus state={tx.state} />
      {rejecting && <RejectModal item={rejecting} nameOf={nameOf} supply={supply} onClose={() => setRejecting(null)} onDone={onDone} />}
    </Card>
  );
}

function RejectModal({ item, nameOf, supply, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const tx = useTx(() => {
    onDone();
    setTimeout(onClose, 900);
  });
  return (
    <Modal title={`Reject batch #${item.batchId}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          tx.run("Reject", () => supply.rejectConsignment(item.batchId, reason.trim()));
        }}
        className="space-y-4"
      >
        <p className="text-sm text-slate-600">
          {units(item.quantity)} units go back to {nameOf(item.from)}. The reason is recorded on chain.
        </p>
        <Field label="Reason">
          <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Seal broken on arrival" required />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={tx.busy}>
            {tx.busy ? "Rejecting…" : "Reject consignment"}
          </Button>
        </div>
        <TxStatus state={tx.state} />
      </form>
    </Modal>
  );
}

// Batches someone holds, soonest expiry first. Each role passes its own buttons.
export function StockTable({ rows, nameOf, actions, empty = "You don't hold any stock yet." }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">{empty}</p>;
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
          {rows.map((b) => {
            const status = batchStatus(b);
            return (
              <tr key={b.id} className="align-top">
                <td className="px-5 py-3 font-mono text-xs text-slate-600">#{b.id.toString()}</td>
                <td className="px-3 py-3">
                  <p className="font-medium">{b.drugName}</p>
                  <p className="text-xs text-slate-500">Made by {nameOf(b.manufacturer)}</p>
                </td>
                <td className="px-3 py-3 text-right tabular-nums">{units(b.stock)}</td>
                <td className="whitespace-nowrap px-3 py-3">{toDate(b.expiryDate)}</td>
                <td className="px-3 py-3">
                  <Badge tone={status.tone}>{status.label}</Badge>
                </td>
                <td className="px-5 py-3">
                  <div className="flex justify-end gap-1.5">{actions(b, status)}</div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Freezes a batch everywhere. Open to the batch's manufacturer and to regulators.
export function RecallModal({ batch, inventory, nameOf, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const tx = useTx(onDone);
  return (
    <Modal title={`Recall batch #${batch.id} · ${batch.drugName}`} onClose={onClose}>
      {tx.state.status === "done" ? (
        <div className="space-y-3 text-sm">
          <p className="font-medium text-rose-700">Batch #{batch.id.toString()} is frozen across the network.</p>
          <p className="text-slate-600">Nobody can transfer, accept or dispense it from block {tx.state.block}. These holders still have units and need to be contacted:</p>
          <ul className="list-disc space-y-1 pl-5">
            {batch.holders.map((h) => (
              <li key={h}>{nameOf(h)}</li>
            ))}
          </ul>
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            tx.run("Recall", () => inventory.flagRecall(batch.id, reason.trim()));
          }}
          className="space-y-4"
        >
          <p className="text-sm text-slate-600">
            One transaction freezes this batch everywhere: no transfers, no acceptances, no dispensing. It <span className="font-medium">cannot be undone.</span>
          </p>
          <Field label="Reason">
            <input className={inputClass} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Contamination found in QA retest" required />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={tx.busy}>
              {tx.busy ? "Recalling…" : "Recall batch"}
            </Button>
          </div>
          <TxStatus state={tx.state} />
        </form>
      )}
    </Modal>
  );
}
