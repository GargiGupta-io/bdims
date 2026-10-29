'use strict';

// Who the Caliper workers are, shared by setup.js and the workload modules.
//
// Caliper gives worker N the account at m/44'/60'/N'/0/0 of the network
// config's fromAddressSeed, and a worker can only ever sign as that one
// account. Our contracts need different roles for different steps (a
// manufacturer dispatches, a pharmacy accepts and dispenses), so the real
// benchmark runs twice, once per seed:
//
//   manufacturers  register, dispatch and recall batches
//   pharmacies     accept those consignments and dispense
//
// Manufacturer worker N always dispatches to pharmacy worker N, so both
// runs must use the same number of workers.

const EthereumHDKey = require('ethereumjs-wallet/hdkey');

const MAX_WORKERS = 10;

const SEEDS = {
    manufacturers: 'bdims-caliper-manufacturers',
    pharmacies: 'bdims-caliper-pharmacies',
};

function workerAddress(seed, index) {
    return EthereumHDKey.fromMasterSeed(seed).derivePath(`m/44'/60'/${index}'/0/0`).getWallet().getChecksumAddressString();
}

function workerAddresses(seed, count = MAX_WORKERS) {
    return Array.from({ length: count }, (_, i) => workerAddress(seed, i));
}

module.exports = { MAX_WORKERS, SEEDS, workerAddress, workerAddresses };
