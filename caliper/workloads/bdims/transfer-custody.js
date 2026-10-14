'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { SEEDS, workerAddress } = require('../../accounts.js');
const { untouchedBatches, takeNext } = require('./helpers.js');

// Manufacturers. Write: dispatches one untouched batch per transaction to
// this worker's paired pharmacy. The units go into escrow until the
// pharmacies' run accepts them.
class TransferCustody extends WorkloadModuleBase {
    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
        await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
        this.pharmacy = workerAddress(SEEDS.pharmacies, workerIndex);
        this.next = takeNext(await untouchedBatches(sutContext), 'untouched batches');
    }

    async submitTransaction() {
        return this.sutAdapter.sendRequests({
            contract: 'SupplyChain',
            verb: 'transferCustody',
            args: [this.next(), this.pharmacy, this.roundArguments.quantity || 1000, 'Benchmark: plant to pharmacy'],
            readOnly: false,
        });
    }
}

module.exports.createWorkloadModule = () => new TransferCustody();
