export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

export const units = (v) => Number(v).toLocaleString("en-IN");

export const toDate = (seconds) =>
  new Date(Number(seconds) * 1000).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export const daysUntil = (seconds) => Math.ceil((Number(seconds) * 1000 - Date.now()) / 86_400_000);

// "2026-10-13" from a date input → unix seconds at 00:00 UTC.
export const dateInputToSeconds = (value) => Math.floor(Date.parse(`${value}T00:00:00Z`) / 1000);

export const todayInput = () => new Date().toISOString().slice(0, 10);
