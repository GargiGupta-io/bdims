import { useCallback, useEffect, useRef, useState } from "react";
import { queryAll } from "../lib/contracts.js";
import { loadIncoming, loadOutgoing, loadParticipants } from "../lib/ledger.js";

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

  useLiveReload(load, provider);

  return { ...data, reload: load };
}

// Runs `load` now and again shortly after every new block, so other
// people's actions show up without a page refresh.
function useLiveReload(load, provider) {
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
}

// For distributors and pharmacies: stock they hold rather than make.
export function useHolderLedger(wallet) {
  const { contracts, deployment, address, provider } = wallet;
  const [data, setData] = useState({ loading: true, participants: {}, holdings: [], incoming: [], outgoing: [], dispensed: [] });
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (!contracts || loading.current) return;
    loading.current = true;
    try {
      const { registry, supply, inventory } = contracts;
      const from = deployment.deployedBlock ?? 0;
      const [participants, received, incoming, outgoing] = await Promise.all([
        loadParticipants(registry, from),
        queryAll(inventory, inventory.filters.StockUpdated(null, null, address), from),
        loadIncoming(supply, address, from),
        loadOutgoing(supply, address, from),
      ]);

      // Every batch that ever reached me, with what I hold now.
      const ids = [...new Set(received.map((e) => e.args.batchId))];
      const rows = await Promise.all(
        ids.map(async (id) => {
          const [b, stock, recalled, threshold, log] = await Promise.all([
            registry.getBatchDetails(id),
            inventory.getFacilityStock(address, id),
            inventory.isRecalled(id),
            inventory.getReorderThreshold(address, id),
            inventory.getDispensingLog(id),
          ]);
          const mine = [...log].filter((r) => r.pharmacy.toLowerCase() === address.toLowerCase());
          return {
            id,
            drugName: b.drugName,
            composition: b.composition,
            manufacturer: b.manufacturer,
            expiryDate: b.expiryDate,
            quantity: b.quantity,
            ipfsHash: b.ipfsHash,
            stock,
            recalled,
            threshold,
            dispensed: mine.map((r) => ({ batchId: id, drugName: b.drugName, quantity: r.quantity, timestamp: r.timestamp })),
          };
        })
      );
      const holdings = rows.filter((r) => r.stock > 0n).sort((a, b) => Number(a.expiryDate - b.expiryDate));
      const dispensed = rows.flatMap((r) => r.dispensed).sort((a, b) => Number(b.timestamp - a.timestamp));

      setData({ loading: false, participants, holdings, incoming, outgoing, dispensed, error: null });
    } catch (e) {
      setData((d) => ({ ...d, loading: false, error: e?.shortMessage || e?.message }));
    } finally {
      loading.current = false;
    }
  }, [contracts, deployment, address]);

  useLiveReload(load, provider);
  return { ...data, reload: load };
}

// For regulators and the admin: every batch on the network, who holds it,
// and every recall. Batch IDs run 1..batchCount with no gaps.
export function useNetworkLedger(wallet) {
  const { contracts, deployment, provider } = wallet;
  const [data, setData] = useState({ loading: true, participants: {}, batches: [], recalls: [] });
  const loading = useRef(false);

  const load = useCallback(async () => {
    if (!contracts || loading.current) return;
    loading.current = true;
    try {
      const { registry, inventory } = contracts;
      const from = deployment.deployedBlock ?? 0;
      const [participants, count, recallEvents] = await Promise.all([
        loadParticipants(registry, from),
        registry.batchCount(),
        queryAll(inventory, inventory.filters.BatchRecalled(), from),
      ]);

      const ids = Array.from({ length: Number(count) }, (_, i) => BigInt(i + 1));
      const batches = await Promise.all(
        ids.map(async (id) => {
          const [b, recalled, holderList] = await Promise.all([registry.getBatchDetails(id), inventory.isRecalled(id), inventory.getAffectedHolders(id)]);
          const holders = [...holderList];
          const stocks = await Promise.all(holders.map((h) => inventory.getFacilityStock(h, id)));
          return {
            id,
            drugName: b.drugName,
            composition: b.composition,
            manufacturer: b.manufacturer,
            mfgDate: b.mfgDate,
            expiryDate: b.expiryDate,
            quantity: b.quantity,
            ipfsHash: b.ipfsHash,
            recalled,
            holders,
            holdings: holders.map((h, i) => ({ address: h, stock: stocks[i] })),
            unitsOut: stocks.reduce((s, v) => s + v, 0n),
          };
        })
      );
      batches.sort((a, b) => Number(b.id - a.id));

      const blocks = await Promise.all([...new Set(recallEvents.map((e) => e.blockNumber))].map((n) => provider.getBlock(n)));
      const time = Object.fromEntries(blocks.map((b) => [b.number, b.timestamp]));
      const recalls = recallEvents
        .map((e) => ({ batchId: e.args.batchId, by: e.args.issuedBy, reason: e.args.reason, timestamp: time[e.blockNumber] }))
        .sort((a, b) => b.timestamp - a.timestamp);

      setData({ loading: false, participants, batches, recalls, error: null });
    } catch (e) {
      setData((d) => ({ ...d, loading: false, error: e?.shortMessage || e?.message }));
    } finally {
      loading.current = false;
    }
  }, [contracts, deployment, provider]);

  useLiveReload(load, provider);
  return { ...data, reload: load };
}
