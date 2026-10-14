import { useState } from "react";
import { isAddress } from "ethers";
import { useTx } from "../hooks/useTx.js";
import { ROLES, roleLabel } from "../lib/roles.js";
import { shortAddr } from "../lib/format.js";
import { Button, Card, Field, Modal, TxStatus, inputClass } from "./ui.jsx";

// The four roles the admin can hand out. ADMIN itself is never offered:
// it is granted once, at deployment.
export const ASSIGNABLE = [ROLES.MANUFACTURER, ROLES.DISTRIBUTOR, ROLES.PHARMACY, ROLES.REGULATOR];

export function RegisterParticipant({ registry, onDone }) {
  const blank = { address: "", name: "", licenceId: "", role: ROLES.MANUFACTURER };
  const [form, setForm] = useState(blank);
  const tx = useTx(() => {
    setForm(blank);
    onDone();
  });
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const badAddress = form.address.trim() !== "" && !isAddress(form.address.trim());

  const submit = (e) => {
    e.preventDefault();
    tx.run("Register participant", () => registry.registerParticipant(form.address.trim(), form.name.trim(), form.licenceId.trim(), form.role));
  };

  return (
    <Card title="Onboard a participant" subtitle="Only registered addresses can act on the ledger.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Wallet address" hint={badAddress ? "That isn't a valid Ethereum address." : "Their MetaMask address, starting 0x."}>
          <input className={inputClass} value={form.address} onChange={set("address")} placeholder="0x…" required />
        </Field>
        <Field label="Organisation name">
          <input className={inputClass} value={form.name} onChange={set("name")} placeholder="Sun Pharma Ltd" required />
        </Field>
        <Field label="Licence ID">
          <input className={inputClass} value={form.licenceId} onChange={set("licenceId")} placeholder="MFG-GJ-1102" required />
        </Field>
        <Field label="Role">
          <select className={inputClass} value={form.role} onChange={set("role")}>
            {ASSIGNABLE.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </Field>
        <Button type="submit" disabled={tx.busy || badAddress} className="w-full">
          {tx.busy ? "Registering…" : "Register participant"}
        </Button>
        <TxStatus state={tx.state} />
      </form>
    </Card>
  );
}

export function ChangeRoleModal({ participant, registry, onClose, onDone }) {
  const options = ASSIGNABLE.filter((r) => r !== participant.role);
  const [role, setRole] = useState(options[0]);
  const tx = useTx(() => {
    onDone();
    setTimeout(onClose, 900);
  });
  return (
    <Modal title={`Change role · ${participant.name}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          tx.run("Change role", () => registry.assignRole(participant.address, role));
        }}
        className="space-y-4"
      >
        <p className="text-sm text-slate-600">
          Currently a <span className="font-medium">{roleLabel(participant.role)}</span>. The old role is removed in the same transaction. Stock they already hold stays theirs.
        </p>
        <Field label="New role">
          <select className={inputClass} value={role} onChange={(e) => setRole(e.target.value)}>
            {options.map((r) => (
              <option key={r} value={r}>
                {roleLabel(r)}
              </option>
            ))}
          </select>
        </Field>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={tx.busy}>
            {tx.busy ? "Saving…" : "Change role"}
          </Button>
        </div>
        <TxStatus state={tx.state} />
      </form>
    </Modal>
  );
}

export function RevokeModal({ participant, registry, onClose, onDone }) {
  const tx = useTx(() => {
    onDone();
    setTimeout(onClose, 900);
  });
  return (
    <Modal title={`Revoke · ${participant.name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-slate-600">
          {participant.name} ({shortAddr(participant.address)}) loses their role and can no longer register, send, accept or dispense anything. Their past transactions stay on the ledger. This{" "}
          <span className="font-medium">can't be undone</span> from the app.
        </p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={tx.busy} onClick={() => tx.run("Revoke", () => registry.revokeParticipant(participant.address))}>
            {tx.busy ? "Revoking…" : "Revoke access"}
          </Button>
        </div>
        <TxStatus state={tx.state} />
      </div>
    </Modal>
  );
}
