import { allErrors } from "./contracts.js";
import { formatUnits } from "ethers";

// The contracts' custom errors, in words a pharmacist or manufacturer can act on.
const MESSAGES = {
  AccessControlUnauthorizedAccount: () => "Your account doesn't have the role this action needs.",
  ZeroQuantity: () => "Quantity must be more than zero.",
  EmptyField: () => "Drug name and certificate are required.",
  InvalidDates: () => "Expiry must be after the manufacture date and in the future.",
  BatchNotFound: (a) => `Batch #${a[0]} doesn't exist. It may be forged.`,
  AlreadyRegistered: () => "That address is already registered.",
  NotRegistered: (a) => `${short(a[0])} isn't a registered participant.`,
  InvalidRole: () => "That isn't a valid participant role.",
  InvalidRoute: () => "That handoff isn't allowed. Stock only moves to a distributor or pharmacy.",
  InsufficientStock: (a) => `Not enough stock: you hold ${num(a.at(-2))}, tried to move ${num(a.at(-1))}.`,
  BatchIsExpired: (a) => `Batch #${a[0]} has expired. It can't be moved or dispensed.`,
  BatchIsRecalled: (a) => `Batch #${a[0]} has been recalled. It can't be moved or dispensed.`,
  TransferAlreadyPending: () => "There's already a transfer of this batch waiting for that recipient.",
  NoPendingTransfer: () => "There's no pending transfer to act on.",
  SelfTransfer: () => "You can't send stock to yourself.",
  ZeroAddress: () => "A recipient address is required.",
  NotPharmacy: () => "Only a pharmacy can dispense.",
  NotAuthorisedToRecall: () => "Only the batch's manufacturer or a regulator can recall it.",
  AlreadyRecalled: (a) => `Batch #${a[0]} is already recalled.`,
};

const short = (addr) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;
const num = (v) => Number(formatUnits(v, 0)).toLocaleString("en-IN");

function findRevertData(err) {
  for (const candidate of [err?.data, err?.info?.error?.data, err?.error?.data, err?.info?.error?.data?.data]) {
    if (typeof candidate === "string" && candidate.startsWith("0x") && candidate.length >= 10) return candidate;
  }
  return null;
}

export function explainError(err) {
  if (err?.code === "ACTION_REJECTED" || err?.info?.error?.code === 4001) return "You cancelled it in your wallet.";
  const data = findRevertData(err);
  if (data) {
    try {
      const parsed = allErrors.parseError(data);
      if (parsed) return (MESSAGES[parsed.name] ?? (() => `Rejected by the contract: ${parsed.name}.`))(parsed.args);
    } catch {
      /* not one of ours */
    }
  }
  if (err?.revert?.name) return (MESSAGES[err.revert.name] ?? (() => `Rejected: ${err.revert.name}.`))(err.revert.args);
  return err?.shortMessage || err?.message || "Something went wrong.";
}
