'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { untouchedBatches, takeNext } = require('./helpers.js');

// Manufacturers. Write: recalls one of this worker's own batches per
// transaction. Takes the NEWEST untouched batches, so it never touches the
// ones the dispatch round sent to pharmacies.
class FlagRecall extends WorkloadModuleBase {
    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
        await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
        this.next = takeNext((await untouchedBatches(sutContext)).reverse(), 'untouched batches');
    }

    async submitTransaction() {
        return this.sutAdapter.sendRequests({
            contract: 'InventoryManager',
            verb: 'flagRecall',
            args: [this.next(), 'Benchmark recall'],
            readOnly: false,
        });
    }
}

module.exports.createWorkloadModule = () => new FlagRecall();
