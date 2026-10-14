'use strict';

// Lookups the bdims workloads share. They run in each worker's
// initializeWorkloadModule, before the round's clock starts, so they never
// count towards the measured latency or throughput.

const contractOf = (sutContext, name) => sutContext.contracts[name].contract;

// Batch IDs this worker registered, oldest first.
async function myBatches(sutContext) {
    const registry = contractOf(sutContext, 'DrugRegistry');
    const events = await registry.getPastEvents('BatchRegistered', { filter: { manufacturer: sutContext.fromAddress }, fromBlock: 0 });
    return events.map((e) => Number(e.returnValues.batchId)).sort((a, b) => a - b);
}

// My batches still exactly as registered: never dispatched, never recalled.
// The dispatch and recall rounds both draw from this pool, from opposite
// ends, so they never pick the same batch.
async function untouchedBatches(sutContext) {
    const registry = contractOf(sutContext, 'DrugRegistry');
    const inventory = contractOf(sutContext, 'InventoryManager');
    const me = sutContext.fromAddress;
    const out = [];
    for (const id of await myBatches(sutContext)) {
        const [batch, stock, recalled] = await Promise.all([
            registry.methods.getBatchDetails(id).call(),
            inventory.methods.getFacilityStock(me, id).call(),
            inventory.methods.isRecalled(id).call(),
        ]);
        if (!recalled && stock === batch.quantity) {
            out.push(id);
        }
    }
    return out;
}

// Hands out items one per transaction and fails clearly when they run out,
// which means the yaml asks for more transactions than the earlier round set up.
function takeNext(list, what) {
    let i = 0;
    return () => {
        if (i >= list.length) {
            throw new Error(`Ran out of ${what} after ${list.length}. Lower this round's txNumber or raise the round that creates them.`);
        }
        return list[i++];
    };
}

module.exports = { contractOf, myBatches, untouchedBatches, takeNext };
