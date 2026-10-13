import { NETWORKS } from "../lib/config.js";
import { roleLabel } from "../lib/roles.js";
import { shortAddr } from "../lib/format.js";
import { Badge, Button } from "./ui.jsx";

export default function Header({ wallet, profile, onVerifyPage }) {
  const network = NETWORKS[wallet.chainId];
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-700 text-sm font-bold text-white">Rx</div>
          <div>
            <p className="text-sm font-semibold leading-tight">BDIMS</p>
            <p className="text-xs leading-tight text-slate-500">Drug Inventory Ledger</p>
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <a href={onVerifyPage ? "#/" : "#/verify"} className="rounded-lg px-2.5 py-1.5 text-sm font-medium text-teal-700 hover:bg-teal-50">
            {onVerifyPage ? "Dashboard" : "Verify a medicine"}
          </a>
        {wallet.status === "ready" && (
          <div className="flex items-center gap-2 sm:gap-3">
            <Badge tone={network ? "teal" : "red"}>{network?.short ?? `Chain ${wallet.chainId}`}</Badge>
            {wallet.mode === "local" && <Badge tone="amber">Test account</Badge>}
            <div className="hidden text-right sm:block">
              <p className="text-sm font-medium leading-tight">{profile.name || shortAddr(wallet.address)}</p>
              <p className="text-xs leading-tight text-slate-500">
                {profile.active ? roleLabel(profile.role) : profile.isAdmin ? "Admin" : "Not registered"} · {shortAddr(wallet.address)}
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
