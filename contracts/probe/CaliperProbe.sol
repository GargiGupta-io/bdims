// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// TEMPORARY. A stand-in for the real contracts so the Caliper pipeline can be
// proven before DrugRegistry, SupplyChain and InventoryManager exist. It copies
// the parts of the real design that are awkward for Caliper: a constructor
// argument, wiring after deployment, and a cross-contract call inside the
// benchmarked write. Delete this folder once the real contracts are benchmarked.

contract ProbeRegistry {
    struct Batch {
        string drugName;
        uint256 quantity;
        uint64 expiryDate;
        address manufacturer;
    }

    event BatchRegistered(uint256 indexed batchId, address indexed manufacturer);

    address public immutable admin;
    ProbeLedger public ledger;
    uint256 public batchCount;
    mapping(uint256 => Batch) private batches;

    constructor(address admin_) {
        admin = admin_;
    }

    function setLedger(address ledger_) external {
        require(msg.sender == admin, "not admin");
        require(address(ledger) == address(0), "already set");
        ledger = ProbeLedger(ledger_);
    }

    function registerBatch(string calldata drugName, uint256 quantity, uint64 expiryDate)
        external
        returns (uint256 batchId)
    {
        require(quantity > 0, "zero quantity");
        require(expiryDate > block.timestamp, "already expired");
        batchId = ++batchCount;
        batches[batchId] = Batch(drugName, quantity, expiryDate, msg.sender);
        ledger.credit(batchId, msg.sender, quantity);
        emit BatchRegistered(batchId, msg.sender);
    }

    function getBatch(uint256 batchId) external view returns (Batch memory) {
        require(batchId > 0 && batchId <= batchCount, "no such batch");
        return batches[batchId];
    }
}

contract ProbeLedger {
    address public immutable registry;
    mapping(uint256 => mapping(address => uint256)) public stock;

    constructor(address registry_) {
        registry = registry_;
    }

    function credit(uint256 batchId, address to, uint256 quantity) external {
        require(msg.sender == registry, "only registry");
        stock[batchId][to] += quantity;
    }
}
