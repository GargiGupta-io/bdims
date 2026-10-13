import { useEffect, useState } from "react";
import { ROLES } from "../lib/roles.js";

// Who the connected address is, according to DrugRegistry.
export function useProfile(contracts, address) {
  const [profile, setProfile] = useState({ loading: true });

  useEffect(() => {
    if (!contracts || !address) return;
    let live = true;
    (async () => {
      setProfile({ loading: true });
      try {
        const [p, isAdmin] = await Promise.all([
          contracts.registry.getParticipant(address),
          contracts.registry.hasRole(ROLES.ADMIN, address),
        ]);
        if (live) setProfile({ loading: false, name: p.name, licenceId: p.licenceId, role: p.role, active: p.active, isAdmin });
      } catch (e) {
        if (live) setProfile({ loading: false, error: "Couldn't read the registry. Are the contracts deployed on this network?" });
      }
    })();
    return () => { live = false; };
  }, [contracts, address]);

  return profile;
}
