import { useCallback, useEffect, useState } from "react";
import { deployments, NETWORKS, PUBLIC_CHAIN_ID, readProvider } from "../lib/config.js";
import { allErrors, getContracts, queryAll } from "../lib/contracts.js";
import { loadParticipants, makeNameOf } from "../lib/ledger.js";
import { daysUntil, toDate, units } from "../lib/format.js";
import { IPFS_GATEWAY } from "../lib/ipfs.js";
import { Button, Card, inputClass } from "../components/ui.jsx";
import { BatchQr, QrScanner } from "../components/qr.jsx";

// Anyone can check a medicine here: no wallet, no account. A batch that a
// licensed manufacturer never registered has no on-chain identity, so it
// fails this check. That is outcome 4 of the synopsis.
export default function VerifyPage({ batchId }) {
  const [input, setInput] = useState(batchId ?? "");
  const [result, setResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  const deployment = deployments[PUBLIC_CHAIN_ID];

  useEffect(() => {
    setInput(batchId ?? "");
    if (!batchId || !deployment) return setResult(null);
    let live = true;
    setResult({ loading: true });
    verify(deployment, batchId)
      .then((r) => live && setResult(r))
      .catch(() => live && setResult({ error: "Couldn't reach the network. Try again in a moment." }));
    return () => { live = false; };
  }, [batchId, deployment]);

  const submit = (e) => {
    e.preventDefault();
    const id = input.trim().replace(/^#/, "");
    if (/^\d+$/.test(id)) window.location.hash = `#/verify/${id}`;
    else setResult({ invalid: true });
  };

  const onScan = useCallback((id) => {
    setScanning(false);
    window.location.hash = `#/verify/${id}`;
  }, []);

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-10 sm:px-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Verify a medicine</h1>
        <p className="mt-1 text-slate-600">Scan the QR code on the pack, or type its batch number. No wallet or account needed.</p>
      </div>

      <form onSubmit={submit} className="flex gap-2">
        <input className={inputClass} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Batch number, e.g. 1" aria-label="Batch number" inputMode="numeric" />
        <Button type="submit">Verify</Button>
        <Button type="button" variant="secondary" className="whitespace-nowrap" onClick={() => setScanning(true)}>
          Scan QR
        </Button>
      </form>
      {scanning && <QrScanner onResult={onScan} onClose={() => setScanning(false)} />}

      {!deployment && <p className="text-sm text-rose-700">The contracts aren't deployed yet, so there's nothing to verify against.</p>}
      {result?.invalid && <p className="text-sm text-rose-700">A batch number is digits only.</p>}
      {result?.loading && <p className="text-sm text-slate-500">Checking the ledger…</p>}
      {result?.error && <p className="text-sm text-rose-700">{result.error}</p>}
      {result?.notFound && <Verdict tone="red" title="Not recognised" text={`No licensed manufacturer ever registered batch #${batchId}. This pack may be counterfeit. Do not use it, and report it to the pharmacy or the drug regulator.`} />}
      {result?.batch && <BatchReport r={result} />}

      <p className="text-xs text-slate-500">
        Read directly from {NETWORKS[PUBLIC_CHAIN_ID].name}. Nobody, including the manufacturer, can edit these records after the fact.
      </p>
    </div>
  );
}

async function verify(deployment, batchId) {
  const provider = readProvider();
  const { registry, supply, inventory } = getContracts(deployment, provider);
  const from = deployment.deployedBlock ?? 0;
  let batch;
  try {
    batch = await registry.getBatchDetails(batchId);
  } catch (e) {
    // Only the contract's own "no such batch" answer means not recognised.
    // Anything else (network trouble) is an error, never a counterfeit verdict.
    const name = e?.revert?.name ?? (typeof e?.data === "string" ? allErrors.parseError(e.data)?.name : null);
    if (name === "BatchNotFound") return { notFound: true };
    throw e;
  }
  const [participants, trail, recalled, recalls] = await Promise.all([
    loadParticipants(registry, from),
    supply.getCustodyHistory(batchId),
    inventory.isRecalled(batchId),
    queryAll(inventory, inventory.filters.BatchRecalled(batchId), from),
  ]);
  let recall = null;
  if (recalled && recalls.length) {
    const ev = recalls.at(-1);
    recall = { reason: ev.args.reason, by: ev.args.issuedBy, timestamp: (await provider.getBlock(ev.blockNumber)).timestamp };
  }
  return { batch, participants, trail: [...trail], recalled, recall, nameOf: makeNameOf(participants, deployment.contracts.SupplyChain) };
}

function Verdict({ tone, title, text }) {
  const style = tone === "green" ? "border-emerald-200 bg-emerald-50 text-emerald-900" : "border-rose-200 bg-rose-50 text-rose-900";
  return (
    <div className={`rounded-xl border px-5 py-4 ${style}`} role="status">
      <p className="text-lg font-semibold">{title}</p>
      <p className="mt-1 text-sm">{text}</p>
    </div>
  );
}

function BatchReport({ r }) {
  const { batch: b, nameOf, recall } = r;
  const maker = nameOf(b.manufacturer);
  const days = daysUntil(b.expiryDate);
  const verdict = r.recalled
    ? { tone: "red", title: "Recalled. Do not use.", text: `Recalled${recall ? ` on ${toDate(recall.timestamp)} by ${nameOf(recall.by)}: "${recall.reason}"` : ""}. Return it to the pharmacy.` }
    : days <= 0
      ? { tone: "red", title: "Expired. Do not use.", text: `This batch expired on ${toDate(b.expiryDate)}.` }
      : { tone: "green", title: "Genuine", text: `Registered on the ledger by ${maker}, a licensed manufacturer. Expires ${toDate(b.expiryDate)}.` };

  return (
    <>
      <Verdict {...verdict} />
      <Card title={`${b.drugName} · batch #${b.batchId.toString()}`} subtitle={b.composition || undefined}>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <Item label="Manufacturer" value={maker} />
          <Item label="Units produced" value={units(b.quantity)} />
          <Item label="Manufactured" value={toDate(b.mfgDate)} />
          <Item label="Expires" value={toDate(b.expiryDate)} />
          <div className="sm:col-span-2">
            <dt className="text-slate-500">Quality certificate</dt>
            <dd className="mt-0.5 break-all">
              <a className="text-teal-700 underline hover:text-teal-800" href={`${IPFS_GATEWAY}${b.ipfsHash}`} target="_blank" rel="noreferrer">
                {b.ipfsHash}
              </a>
            </dd>
          </div>
        </dl>
      </Card>
      <Card title="QR code for this batch" subtitle="The code printed on every pack. Scanning it opens this page.">
        <BatchQr batchId={b.batchId.toString()} drugName={b.drugName} size={160} />
      </Card>
      <Card title="Where it has been" subtitle="Every handoff, signed by the party that made it.">
        <ol className="relative space-y-4 border-l border-slate-200 pl-5">
          {r.trail.map((t, i) => (
            <li key={i} className="text-sm">
              <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-teal-600" />
              <p className="font-medium">{i === 0 ? `Manufactured by ${nameOf(t.to)}` : `${nameOf(t.from)} → ${nameOf(t.to)}`}</p>
              <p className="text-xs text-slate-500">
                {units(t.quantity)} units · {t.location} · {toDate(t.timestamp)}
              </p>
            </li>
          ))}
        </ol>
      </Card>
    </>
  );
}

function Item({ label, value }) {
  return (
    <div>
      <dt className="text-slate-500">{label}</dt>
      <dd className="mt-0.5 font-medium">{value}</dd>
    </div>
  );
}
