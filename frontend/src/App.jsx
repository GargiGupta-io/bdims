import { useEffect, useState } from "react";
import Header from "./components/Header.jsx";
import ConnectScreen from "./components/ConnectScreen.jsx";
import { useWallet } from "./hooks/useWallet.js";
import { useProfile } from "./hooks/useProfile.js";
import { ROLES } from "./lib/roles.js";
import ManufacturerDashboard from "./pages/ManufacturerDashboard.jsx";
import DistributorDashboard from "./pages/DistributorDashboard.jsx";
import PharmacyDashboard from "./pages/PharmacyDashboard.jsx";
import RegulatorDashboard from "./pages/RegulatorDashboard.jsx";
import { ComingSoon, NotRegistered, WrongNetwork } from "./pages/Holding.jsx";
import VerifyPage from "./pages/VerifyPage.jsx";

// "#/verify" or "#/verify/<batch>" opens the public page; anything else is the dashboard.
function useRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const [, page, arg] = hash.split("/");
  return page === "verify" ? { page: "verify", batchId: arg || null } : { page: "app" };
}

// One shell for everyone. What you see depends on the role the registry
// gives your wallet address, not on anything you choose in the app.
export default function App() {
  const wallet = useWallet();
  const profile = useProfile(wallet.contracts, wallet.address);
  const route = useRoute();

  let body;
  if (route.page === "verify") body = <VerifyPage batchId={route.batchId} />;
  else if (wallet.status !== "ready") body = <ConnectScreen wallet={wallet} />;
  else if (!wallet.deployment) body = <WrongNetwork wallet={wallet} />;
  else if (profile.loading) body = <p className="py-16 text-center text-sm text-slate-500">Reading the registry…</p>;
  else if (profile.error) body = <p className="py-16 text-center text-sm text-rose-700">{profile.error}</p>;
  else if (profile.active && profile.role === ROLES.MANUFACTURER) body = <ManufacturerDashboard wallet={wallet} profile={profile} />;
  else if (profile.active && profile.role === ROLES.DISTRIBUTOR) body = <DistributorDashboard wallet={wallet} profile={profile} />;
  else if (profile.active && profile.role === ROLES.PHARMACY) body = <PharmacyDashboard wallet={wallet} profile={profile} />;
  else if (profile.active && profile.role === ROLES.REGULATOR) body = <RegulatorDashboard wallet={wallet} profile={profile} />;
  else if (profile.isAdmin) body = <ComingSoon role="Admin" />;
  else body = <NotRegistered address={wallet.address} />;

  return (
    <div className="min-h-screen">
      <Header wallet={wallet} profile={profile} onVerifyPage={route.page === "verify"} />
      <main>{body}</main>
    </div>
  );
}
