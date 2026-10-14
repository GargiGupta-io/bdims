'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { contractOf, takeNext } = require('./helpers.js');

// Pharmacies. Write: accepts one consignment waiting for this worker per
// transaction, moving the units out of escrow into its stock.
class AcceptConsignment extends WorkloadModuleBase {
    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
        await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
        const supply = contractOf(sutContext, 'SupplyChain');
        const me = sutContext.fromAddress;
        const sent = await supply.getPastEvents('CustodyTransferInitiated', { filter: { to: me }, fromBlock: 0 });
        const ids = [...new Set(sent.map((e) => Number(e.returnValues.batchId)))].sort((a, b) => a - b);
        const pending = [];
        for (const id of ids) {
            if (await supply.methods.hasPendingTransfer(id, me).call()) {
                pending.push(id);
            }
        }
        this.next = takeNext(pending, 'pending consignments (run the manufacturers benchmark first)');
    }

    async submitTransaction() {
        return this.sutAdapter.sendRequests({
            contract: 'SupplyChain',
            verb: 'acceptConsignment',
            args: [this.next()],
            readOnly: false,
        });
    }
}

module.exports.createWorkloadModule = () => new AcceptConsignment();
