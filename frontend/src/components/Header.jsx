import { NETWORKS } from "../lib/config.js";
import { roleLabel } from "../lib/roles.js";
import { shortAddr } from "../lib/format.js";
import { Badge, Button } from "./ui.jsx";

const LINKS = [
  { page: "app", href: "#/", label: "Dashboard" },
  { page: "verify", href: "#/verify", label: "Verify a medicine" },
  { page: "dev", href: "#/dev", label: "Developer" },
];

export default function Header({ wallet, profile, page }) {
  const network = NETWORKS[wallet.chainId];
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-700 text-sm font-bold text-white">Rx</div>
          <div>
            <p className="text-sm font-semibold leading-tight">BDIMS</p>
            <p className="text-xs leading-tight text-slate-500">Drug Inventory Ledger</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <nav className="flex items-center gap-1">
            {LINKS.filter((l) => l.page !== page).map((l) => (
              <a key={l.page} href={l.href} className="whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50 sm:px-2.5">
                {l.label}
              </a>
            ))}
          </nav>
        {wallet.status === "ready" && (
          <div className="flex items-center gap-2 sm:gap-3">
            <Badge tone={network ? "teal" : "red"}>{network?.short ?? `Chain ${wallet.chainId}`}</Badge>
            {wallet.mode === "local" && <Badge tone="amber">Test account</Badge>}
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{profile.name || shortAddr(wallet.address)}</p>
              <p className="text-xs leading-tight text-slate-500">
                {profile.active ? roleLabel(profile.role) : profile.isAdmin ? "Admin" : profile.name ? "Revoked" : "Not registered"} · {shortAddr(wallet.address)}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={wallet.disconnect}>
              Disconnect
            </Button>
          </div>
        )}
        </div>
      </div>
    </header>
  );
}
