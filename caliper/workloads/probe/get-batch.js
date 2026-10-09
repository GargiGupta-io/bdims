'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

// Read round: looks up random existing batches. Reads need no signature and
// no block, so this is the ceiling the write rounds are compared against.
class GetBatch extends WorkloadModuleBase {
    async initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext) {
        await super.initializeWorkloadModule(workerIndex, totalWorkers, roundIndex, roundArguments, sutAdapter, sutContext);
        const registry = sutContext.contracts.ProbeRegistry.contract;
        this.batchCount = Number(await registry.methods.batchCount().call());
        if (this.batchCount === 0) {
            throw new Error('No batches on chain. The registerBatch round must run first.');
        }
    }

    async submitTransaction() {
        const batchId = 1 + Math.floor(Math.random() * this.batchCount);
        return this.sutAdapter.sendRequests({
            contract: 'ProbeRegistry',
            verb: 'getBatch',
            args: [batchId],
            readOnly: true,
        });
    }
}

module.exports.createWorkloadModule = () => new GetBatch();
