// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Stands in for SupplyChain in Khush's tests. It only needs the one function
// DrugRegistry calls. It records the call so a test can check it happened.
contract MockSupplyChainForRegistry {
    uint256 public lastBatchId;
    address public lastManufacturer;
    uint256 public lastQuantity;

    function initialiseCustody(uint256 batchId, address manufacturer, uint256 quantity) external {
        lastBatchId = batchId;
        lastManufacturer = manufacturer;
        lastQuantity = quantity;
    }
}
