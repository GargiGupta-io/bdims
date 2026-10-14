import { useState } from "react";
import { CERTIFICATE_TYPES, IPFS_GATEWAY, forgetKey, saveKey, savedKey, uploadCertificate } from "../lib/ipfs.js";
import { Button, Field, inputClass } from "./ui.jsx";

// The QA certificate for a new batch. Uploading stores the file on IPFS and
// gives back its CID, a fingerprint of the file's exact contents, which is
// what goes on chain. Anyone can later fetch the file by that CID and know
// it hasn't been swapped.
export default function CertificateField({ value, onChange }) {
  const [mode, setMode] = useState("upload");
  const [file, setFile] = useState(null);
  const [key, setKey] = useState(savedKey);
  const [hasSavedKey, setHasSavedKey] = useState(Boolean(savedKey()));
  const [state, setState] = useState({ status: "idle" });

  const upload = async () => {
    setState({ status: "uploading" });
    try {
      const cid = await uploadCertificate(file, key.trim());
      saveKey(key.trim());
      setHasSavedKey(true);
      setState({ status: "idle" });
      onChange(cid);
    } catch (e) {
      setState({ status: "error", message: e.message });
    }
  };

  const forget = () => {
    forgetKey();
    setKey("");
    setHasSavedKey(false);
  };

  if (value && mode === "upload") {
    return (
      <Field label="QA certificate">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
          <div className="min-w-0">
            <p className="font-medium text-emerald-800">Uploaded to IPFS</p>
            <a className="block truncate font-mono text-xs text-teal-700 underline" href={`${IPFS_GATEWAY}${value}`} target="_blank" rel="noreferrer">
              {value}
            </a>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={() => onChange("")}>
            Change
          </Button>
        </div>
      </Field>
    );
  }

  if (mode === "paste") {
    return (
      <Field label="QA certificate (IPFS CID)" hint={<button type="button" className="underline" onClick={() => { setMode("upload"); onChange(""); }}>Upload a file instead</button>}>
        <input className={inputClass} value={value} onChange={(e) => onChange(e.target.value)} placeholder="bafkrei…" required />
      </Field>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3">
      <Field label="QA certificate" hint="PDF, PNG or JPEG, up to 10 MB.">
        <input type="file" accept={CERTIFICATE_TYPES} onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:font-medium hover:file:bg-slate-200" aria-label="Certificate file" />
      </Field>
      {hasSavedKey ? (
        <p className="text-xs text-slate-500">
          Using the Pinata key saved in this browser.{" "}
          <button type="button" className="underline" onClick={forget}>
            Forget it
          </button>
        </p>
      ) : (
        <Field label="Your Pinata key (JWT)" hint="Needs the Files: Write permission. Saved only in this browser, never sent anywhere except Pinata.">
          <input type="password" className={inputClass} value={key} onChange={(e) => setKey(e.target.value)} placeholder="eyJhbGciOi…" autoComplete="off" aria-label="Pinata key" />
        </Field>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={!file || !key.trim() || state.status === "uploading"} onClick={upload}>
          {state.status === "uploading" ? "Uploading…" : "Upload certificate"}
        </Button>
        <button type="button" className="text-xs text-slate-500 underline" onClick={() => setMode("paste")}>
          I already have a CID
        </button>
      </div>
      {state.status === "error" && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">{state.message}</p>}
    </div>
  );
}
