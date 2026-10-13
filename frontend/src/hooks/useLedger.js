import { useCallback, useEffect, useRef, useState } from "react";
import { queryAll } from "../lib/contracts.js";
import { loadOutgoing, loadParticipants } from "../lib/ledger.js";

// Everything the manufacturer dashboard shows, read straight from the chain.
// Reloads on every new block, so other people's actions appear without a refresh.
export function useManufacturerLedger(wallet) {
  const { contracts, deployment, address, provider } = wallet;
  const [data, setData] = useState({ loading: true, participants: {}, batches: [], inTransit: [] });
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (!contracts || loading.current) return;
    loading.current = true;
    try {
      const { registry, supply, inventory } = contracts;
      const from = deployment.deployedBlock ?? 0;
      const [participants, made, inTransit] = await Promise.all([
        loadParticipants(registry, from),
        queryAll(registry, registry.filters.BatchRegistered(null, address), from),
        loadOutgoing(supply, address, from),
      ]);

      // The batches this manufacturer registered.
      const ids = [...new Set(made.map((e) => e.args.batchId))];
      const batches = await Promise.all(
        ids.map(async (id) => {
          const [b, stock, recalled, holders] = await Promise.all([
            registry.getBatchDetails(id),
            inventory.getFacilityStock(address, id),
            inventory.isRecalled(id),
            inventory.getAffectedHolders(id),
          ]);
          return {
            id,
            drugName: b.drugName,
            composition: b.composition,
            mfgDate: b.mfgDate,
            expiryDate: b.expiryDate,
            quantity: b.quantity,
            ipfsHash: b.ipfsHash,
            stock,
            recalled,
            holders: [...holders],
          };
        })
      );
      batches.sort((a, b) => Number(b.id - a.id));

      setData({ loading: false, participants, batches, inTransit, error: null });
    } catch (e) {
      setData((d) => ({ ...d, loading: false, error: e?.shortMessage || e?.message }));
    } finally {
      loading.current = false;
    }
  }, [contracts, deployment, address]);

  useEffect(() => {
    load();
    if (!provider) return;
    let timer;
    const onBlock = () => {
      clearTimeout(timer);
      timer = setTimeout(load, 400);
    };
    provider.on("block", onBlock);
    return () => {
      clearTimeout(timer);
      provider.off("block", onBlock);
    };
  }, [load, provider]);

  return { ...data, reload: load };
}
