'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');
const { contractOf } = require('./helpers.js');

// Any group. Read: calls a view function on a random existing batch.
// Reads need no signature and no block, so these rounds are the ceiling the
// write rounds are compared against.
//
// roundArguments: { contract: 'DrugRegistry', verb: 'getBatchDetails' }
class ReadBatch extends WorkloadModuleBase {
    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
        await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
        this.batchCount = Number(await contractOf(sutContext, 'DrugRegistry').methods.batchCount().call());
        if (this.batchCount === 0) {
            throw new Error('No batches on chain. The registerBatch round must run first.');
        }
    }

    async submitTransaction() {
        return this.sutAdapter.sendRequests({
            contract: this.roundArguments.contract,
            verb: this.roundArguments.verb,
            args: [1 + Math.floor(Math.random() * this.batchCount)],
            readOnly: true,
        });
    }
}

module.exports.createWorkloadModule = () => new ReadBatch();
