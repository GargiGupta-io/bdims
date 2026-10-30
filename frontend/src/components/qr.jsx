import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import { Button, Modal } from "./ui.jsx";

// A batch's QR code holds the link to its Verify page, so any phone camera
// opens the check directly. The link uses whatever address this site is
// served from (GitHub Pages or IPFS), so it always points back to the same site.
export function verifyUrl(batchId) {
  return `${window.location.origin}${window.location.pathname}#/verify/${batchId}`;
}

// Accepts what a scanned code may hold: one of our Verify links, or a bare
// batch number. Anything else is not a BDIMS code.
export function batchIdFromQr(text) {
  const s = text.trim();
  const link = s.match(/#\/verify\/(\d+)\s*$/);
  if (link) return link[1];
  return /^\d+$/.test(s) ? s : null;
}

export function BatchQr({ batchId, drugName, size = 200 }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    QRCode.toDataURL(verifyUrl(batchId), { width: size * 2, margin: 1, color: { dark: "#0f172a", light: "#ffffff" } }).then(setSrc);
  }, [batchId, size]);
  if (!src) return null;
  return (
    <div className="flex flex-col items-center gap-2">
      <img src={src} width={size} height={size} alt={`QR code for batch #${batchId}`} className="rounded border border-slate-200" />
      <a className="text-xs text-teal-700 underline" href={src} download={`bdims-batch-${batchId}${drugName ? `-${drugName.replace(/\W+/g, "-")}` : ""}.png`}>
        Download for printing
      </a>
    </div>
  );
}

export function QrModal({ batch, onClose }) {
  return (
    <Modal title={`QR code · batch #${batch.id} · ${batch.drugName}`} onClose={onClose}>
      <BatchQr batchId={batch.id.toString()} drugName={batch.drugName} size={220} />
      <p className="mt-4 text-sm text-slate-600">
        Print this on every pack of the batch. Scanning it opens the public Verify page for batch #{batch.id.toString()}, with no app or wallet needed.
      </p>
    </Modal>
  );
}

// Reads QR codes from the camera. Browsers only allow camera access on
// https pages (or localhost), which both GitHub Pages and IPFS gateways are.
export function QrScanner({ onResult, onClose }) {
  const video = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let stream, frame, stopped = false;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const tick = () => {
      if (stopped) return;
      const v = video.current;
      if (v && v.readyState === v.HAVE_ENOUGH_DATA) {
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        const code = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
        if (code) {
          const id = batchIdFromQr(code.data);
          if (id) return onResult(id);
          setError("That QR code isn't a BDIMS batch code.");
        }
      }
      frame = requestAnimationFrame(tick);
    };
    navigator.mediaDevices
      ?.getUserMedia({ video: { facingMode: "environment" } })
      .then((s) => {
        stream = s;
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        video.current.srcObject = s;
        video.current.play();
        tick();
      })
      .catch(() => setError("Couldn't open the camera. Allow camera access, or type the batch number instead."));
    if (!navigator.mediaDevices) setError("This browser can't use the camera here. Type the batch number instead.");
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <Modal title="Scan the QR code on the pack" onClose={onClose}>
      <video ref={video} className="aspect-square w-full rounded-lg bg-slate-900 object-cover" muted playsInline />
      {error ? <p className="mt-3 text-sm text-rose-700">{error}</p> : <p className="mt-3 text-sm text-slate-600">Hold the code inside the frame.</p>}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}
