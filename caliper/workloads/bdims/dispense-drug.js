'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { contractOf } = require('./helpers.js');

// Pharmacies. Write: dispenses a few units per transaction, cycling through
// the batches this worker holds. Each call runs the full safety check
// (role, recall, expiry, stock) before debiting.
class DispenseDrug extends WorkloadModuleBase {
    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
        await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
        const supply = contractOf(sutContext, 'SupplyChain');
        const inventory = contractOf(sutContext, 'InventoryManager');
        const me = sutContext.fromAddress;
        const accepted = await supply.getPastEvents('CustodyTransferAccepted', { filter: { to: me }, fromBlock: 0 });
        const ids = [...new Set(accepted.map((e) => Number(e.returnValues.batchId)))];
        this.held = [];
        for (const id of ids) {
            const [stock, recalled] = await Promise.all([inventory.methods.getFacilityStock(me, id).call(), inventory.methods.isRecalled(id).call()]);
            if (!recalled && Number(stock) > 0) {
                this.held.push(id);
            }
        }
        if (this.held.length === 0) {
            throw new Error('This pharmacy holds no stock. The acceptConsignment round must run first.');
        }
        this.i = 0;
    }

    async submitTransaction() {
        const batchId = this.held[this.i++ % this.held.length];
        return this.sutAdapter.sendRequests({
            contract: 'InventoryManager',
            verb: 'dispenseDrug',
            args: [batchId, this.roundArguments.quantity || 1],
            readOnly: false,
        });
    }
}

module.exports.createWorkloadModule = () => new DispenseDrug();
