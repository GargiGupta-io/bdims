'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

// Write round: registers a batch. Each call also writes to the second contract,
// like the real registerBatch -> initialiseCustody -> updateStock chain.
class RegisterBatch extends WorkloadModuleBase {
    async submitTransaction() {
        const oneYear = 365 * 24 * 60 * 60;
        const expiry = Math.floor(Date.now() / 1000) + oneYear;
        return this.sutAdapter.sendRequests({
            contract: 'ProbeRegistry',
            verb: 'registerBatch',
            args: ['Paracetamol 500mg', 10000, expiry],
            readOnly: false,
        });
    }
}

module.exports.createWorkloadModule = () => new RegisterBatch();
