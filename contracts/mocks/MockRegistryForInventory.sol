// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IDrugRegistry} from "../interfaces/IDrugRegistry.sol";

// Stands in for DrugRegistry in Ronit's tests: roles, batch details and the
// status write that flagRecall makes. Setters let a test shape each case.
contract MockRegistryForInventory {
    mapping(bytes32 => mapping(address => bool)) private roles;
    mapping(uint256 => IDrugRegistry.Batch) private batches;
    mapping(uint256 => IDrugRegistry.BatchStatus) public lastStatus;

    function setRole(bytes32 role, address account) external { roles[role][account] = true; }

    function setBatch(uint256 batchId, address manufacturer, uint64 expiryDate) external {
        batches[batchId].batchId = batchId;
        batches[batchId].manufacturer = manufacturer;
        batches[batchId].expiryDate = expiryDate;
    }

    function hasRole(bytes32 role, address account) external view returns (bool) { return roles[role][account]; }

    function getBatchDetails(uint256 batchId) external view returns (IDrugRegistry.Batch memory) {
        if (batches[batchId].batchId == 0) revert IDrugRegistry.BatchNotFound(batchId);
        return batches[batchId];
    }

    function setBatchStatus(uint256 batchId, IDrugRegistry.BatchStatus status) external {
        lastStatus[batchId] = status;
    }
}
