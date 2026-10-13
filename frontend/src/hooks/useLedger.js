import { useCallback, useEffect, useRef, useState } from "react";
import { queryAll } from "../lib/contracts.js";

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
      const [joined, made, sent] = await Promise.all([
        queryAll(registry, registry.filters.ParticipantRegistered(), from),
        queryAll(registry, registry.filters.BatchRegistered(null, address), from),
        queryAll(supply, supply.filters.CustodyTransferInitiated(null, address), from),
      ]);

      // Directory of participants, with their CURRENT role and status.
      const accounts = [...new Set(joined.map((e) => e.args.account))];
      const participants = {};
      for (const [i, p] of (await Promise.all(accounts.map((a) => registry.getParticipant(a)))).entries()) {
        participants[accounts[i].toLowerCase()] = { address: accounts[i], name: p.name, role: p.role, active: p.active };
      }

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

      // Consignments sent and not yet accepted, rejected or cancelled.
      const pairs = [...new Map(sent.map((e) => [`${e.args.batchId}-${e.args.to}`, e.args])).values()];
      const open = await Promise.all(
        pairs.map(async ({ batchId, to }) => ((await supply.hasPendingTransfer(batchId, to)) ? { batchId, to, ...(await supply.getPendingTransfer(batchId, to)).toObject() } : null))
      );

      setData({ loading: false, participants, batches, inTransit: open.filter(Boolean), error: null });
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
