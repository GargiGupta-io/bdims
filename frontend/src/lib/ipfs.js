// Uploads QA certificates to IPFS through Pinata, straight from the browser.
//
// The Pinata key is NEVER part of the app: anything in this bundle ships to
// every visitor. Each manufacturer pastes their own key, which is kept only
// in their own browser (localStorage) until they choose to forget it.

const UPLOAD_URL = import.meta.env.VITE_PINATA_UPLOAD_URL || "https://uploads.pinata.cloud/v3/files";
const KEY_NAME = "bdims.pinataJwt";

export const MAX_CERTIFICATE_BYTES = 10 * 1024 * 1024;
export const CERTIFICATE_TYPES = "application/pdf,image/png,image/jpeg";

export function savedKey() {
  try {
    return localStorage.getItem(KEY_NAME) || "";
  } catch {
    return "";
  }
}

export function saveKey(jwt) {
  try {
    localStorage.setItem(KEY_NAME, jwt);
  } catch {
    /* private window: the key just lasts for this page */
  }
}

export function forgetKey() {
  try {
    localStorage.removeItem(KEY_NAME);
  } catch {
    /* nothing stored */
  }
}

// Returns the file's CID. "public" matters: Pinata's v3 API stores files
// privately by default, and a private file can't be opened from a gateway,
// so the verification page couldn't show the certificate.
export async function uploadCertificate(file, jwt) {
  if (file.size > MAX_CERTIFICATE_BYTES) throw new Error("The certificate is over 10 MB.");
  const body = new FormData();
  body.append("file", file, file.name);
  body.append("network", "public");
  body.append("name", `bdims-certificate-${file.name}`);

  let res;
  try {
    res = await fetch(UPLOAD_URL, { method: "POST", headers: { Authorization: `Bearer ${jwt}` }, body });
  } catch {
    throw new Error("Couldn't reach Pinata. Check your connection.");
  }
  if (res.status === 401 || res.status === 403) throw new Error("Pinata rejected the key. It needs the Files: Write permission.");
  if (!res.ok) throw new Error(`Pinata refused the upload (HTTP ${res.status}).`);
  const json = await res.json();
  const cid = json?.data?.cid;
  if (!cid) throw new Error("Pinata didn't return a CID.");
  return cid;
}
