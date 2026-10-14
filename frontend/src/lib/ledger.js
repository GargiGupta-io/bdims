import { queryAll } from "./contracts.js";
import { daysUntil, shortAddr } from "./format.js";

export const EXPIRY_WARNING_DAYS = 30;

// Every participant ever registered, with their CURRENT name, licence, role and status.
export async function loadParticipants(registry, fromBlock) {
  const joined = await queryAll(registry, registry.filters.ParticipantRegistered(), fromBlock);
  const accounts = [...new Set(joined.map((e) => e.args.account))];
  const records = await Promise.all(accounts.map((a) => registry.getParticipant(a)));
  const directory = {};
  records.forEach((p, i) => {
    directory[accounts[i].toLowerCase()] = { address: accounts[i], name: p.name, licenceId: p.licenceId, role: p.role, active: p.active };
  });
  return directory;
}

// Open transfers matching an event filter (sent by me, or sent to me).
async function loadPending(supply, filter, fromBlock) {
  const events = await queryAll(supply, filter, fromBlock);
  const pairs = [...new Map(events.map((e) => [`${e.args.batchId}-${e.args.to}`, e.args])).values()];
  const open = await Promise.all(
    pairs.map(async ({ batchId, to }) =>
      (await supply.hasPendingTransfer(batchId, to)) ? { batchId, to, ...(await supply.getPendingTransfer(batchId, to)).toObject() } : null
    )
  );
  return open.filter(Boolean);
}

// Consignments I dispatched that nobody has accepted, rejected or cancelled yet.
export const loadOutgoing = (supply, address, fromBlock) => loadPending(supply, supply.filters.CustodyTransferInitiated(null, address), fromBlock);

// Consignments waiting for ME to accept or reject.
export const loadIncoming = (supply, address, fromBlock) => loadPending(supply, supply.filters.CustodyTransferInitiated(null, null, address), fromBlock);

// Turns an address into a readable name. The zero address means "manufactured",
// and the SupplyChain contract's own address is stock in transit (escrow).
export function makeNameOf(participants, escrowAddress) {
  const escrow = escrowAddress.toLowerCase();
  return (addr) => {
    if (!addr || /^0x0+$/.test(addr)) return "Manufactured";
    if (addr.toLowerCase() === escrow) return "In transit";
    return participants[addr.toLowerCase()]?.name ?? shortAddr(addr);
  };
}

export function batchStatus({ recalled, expiryDate }) {
  if (recalled) return { tone: "red", label: "Recalled", frozen: true };
  const days = daysUntil(expiryDate);
  if (days <= 0) return { tone: "red", label: "Expired", frozen: true };
  if (days <= EXPIRY_WARNING_DAYS) return { tone: "amber", label: `Expires in ${days}d`, frozen: false };
  return { tone: "green", label: "Active", frozen: false };
}
