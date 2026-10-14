// Uploads a QA certificate to IPFS through Pinata and prints its CID, for
// pasting into "Register a batch" or passing to registerBatch() in a script.
//
//   npm run upload:cert -- path/to/certificate.pdf
//
// Reads PINATA_JWT from .env (Files: Write permission). Runs in Node, not the
// browser, so the key never leaves this machine except to go to Pinata.

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const UPLOAD_URL = process.env.PINATA_UPLOAD_URL || "https://uploads.pinata.cloud/v3/files";
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" };

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("Usage: npm run upload:cert -- path/to/certificate.pdf");
  if (!process.env.PINATA_JWT) throw new Error("PINATA_JWT is missing from .env.");
  const type = TYPES[path.extname(file).toLowerCase()];
  if (!type) throw new Error("The certificate must be a PDF, PNG or JPEG.");
  const bytes = fs.readFileSync(file);
  if (bytes.length > MAX_BYTES) throw new Error("The certificate is over 10 MB.");

  const body = new FormData();
  body.append("file", new Blob([bytes], { type }), path.basename(file));
  // Pinata's v3 API stores files privately unless told otherwise, and a
  // private file can't be opened from a public gateway.
  body.append("network", "public");
  body.append("name", `bdims-certificate-${path.basename(file)}`);

  const res = await fetch(UPLOAD_URL, { method: "POST", headers: { Authorization: `Bearer ${process.env.PINATA_JWT}` }, body });
  if (res.status === 401 || res.status === 403) throw new Error("Pinata rejected PINATA_JWT. It needs the Files: Write permission.");
  if (!res.ok) throw new Error(`Pinata refused the upload (HTTP ${res.status}): ${await res.text()}`);
  const cid = (await res.json())?.data?.cid;
  if (!cid) throw new Error("Pinata didn't return a CID.");

  console.log(cid);
  console.error(`View it at https://ipfs.io/ipfs/${cid}`);
}

main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
