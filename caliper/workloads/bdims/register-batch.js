'use strict';

const { WorkloadModuleBase } = require('@hyperledger/caliper-core');

// Manufacturers. Write: registerBatch, which also calls SupplyChain
// (initialiseCustody) and InventoryManager (updateStock), so one transaction
// touches all three contracts.
class RegisterBatch extends WorkloadModuleBase {
    async submitTransaction() {
        const now = Math.floor(Date.now() / 1000);
        const day = 24 * 60 * 60;
        return this.sutAdapter.sendRequests({
            contract: 'DrugRegistry',
            verb: 'registerBatch',
            args: [
                'Paracetamol 500mg',
                'Paracetamol IP 500 mg',
                now - day,
                now + 730 * day,
                this.roundArguments.quantity || 10000,
                'bafkreibenchmarkqacertificate000000000000000000000000',
            ],
            readOnly: false,
        });
    }
}

module.exports.createWorkloadModule = () => new RegisterBatch();
