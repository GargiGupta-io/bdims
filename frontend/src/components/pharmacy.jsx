import { useState } from "react";
import { useTx } from "../hooks/useTx.js";
import { daysUntil, units } from "../lib/format.js";
import { EXPIRY_WARNING_DAYS } from "../lib/ledger.js";
import { Button, Field, Modal, TxStatus, inputClass } from "./ui.jsx";

// Giving medicine to a patient. The contract itself refuses expired or
// recalled stock here; the app only explains the refusal.
export function DispenseModal({ batch, inventory, onClose, onDone }) {
  const [quantity, setQuantity] = useState("");
  const [lowStock, setLowStock] = useState(null);
  const tx = useTx((receipt) => {
    const alert = receipt.logs.map((l) => inventory.interface.parseLog(l)).find((e) => e?.name === "LowStockAlert");
    setLowStock(alert ? alert.args : null);
    onDone();
  });
  const days = daysUntil(batch.expiryDate);

  return (
    <Modal title={`Dispense · ${batch.drugName}`} onClose={onClose}>
      {tx.state.status === "done" ? (
        <div className="space-y-3 text-sm">
          <p className="font-medium text-emerald-700">Dispensed and recorded in block {tx.state.block}.</p>
          {lowStock && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-amber-900">
              Stock is down to {units(lowStock.remaining)}, below your reorder level of {units(lowStock.threshold)}. Time to reorder.
            </p>
          )}
          <div className="flex justify-end">
            <Button onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            tx.run("Dispense", () => inventory.dispenseDrug(batch.id, BigInt(quantity || 0)));
          }}
          className="space-y-4"
        >
          <p className="text-sm text-slate-600">
            Batch #{batch.id.toString()} · {units(batch.stock)} units on your shelf.
          </p>
          {days > 0 && days <= EXPIRY_WARNING_DAYS && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">This batch expires in {days} days. Dispense it before newer stock.</p>
          )}
          <Field label="Units to dispense">
            <input type="number" min="1" max={batch.stock.toString()} step="1" className={inputClass} value={quantity} onChange={(e) => setQuantity(e.target.value)} required autoFocus />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={tx.busy}>
              {tx.busy ? "Dispensing…" : "Dispense"}
            </Button>
          </div>
          <TxStatus state={tx.state} />
        </form>
      )}
    </Modal>
  );
}

// The stock level below which this pharmacy gets a low-stock alert for a batch.
export function ReorderModal({ batch, inventory, onClose, onDone }) {
  const [level, setLevel] = useState(batch.threshold > 0n ? batch.threshold.toString() : "");
  const tx = useTx(() => {
    onDone();
    setTimeout(onClose, 900);
  });
  return (
    <Modal title={`Reorder level · ${batch.drugName}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          tx.run("Set reorder level", () => inventory.setReorderThreshold(batch.id, BigInt(level || 0)));
        }}
        className="space-y-4"
      >
        <p className="text-sm text-slate-600">When your stock of batch #{batch.id.toString()} drops below this, dispensing raises a low-stock alert. 0 turns it off.</p>
        <Field label="Reorder level (units)">
          <input type="number" min="0" step="1" className={inputClass} value={level} onChange={(e) => setLevel(e.target.value)} required />
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={tx.busy}>
            {tx.busy ? "Saving…" : "Save"}
          </Button>
        </div>
        <TxStatus state={tx.state} />
      </form>
    </Modal>
  );
}
