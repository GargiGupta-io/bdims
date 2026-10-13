// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Stand-ins for DrugRegistry and InventoryManager in Pranav's tests.
// Each has only the functions SupplyChain calls, plus setters so a test
// can put the world into whatever state it needs.

contract MockRegistryForSupplyChain {
    mapping(bytes32 => mapping(address => bool)) private roles;
    mapping(address => bool) private registered;

    function setParticipant(address account, bytes32 role) external {
        roles[role][account] = true;
        registered[account] = true;
    }

    function hasRole(bytes32 role, address account) external view returns (bool) {
        return roles[role][account];
    }

    function isRegistered(address account) external view returns (bool) {
        return registered[account];
    }

    function callInitialiseCustody(address supplyChain, uint256 batchId, address manufacturer, uint256 quantity)
        external
    {
        (bool ok, bytes memory err) = supplyChain.call(
            abi.encodeWithSignature("initialiseCustody(uint256,address,uint256)", batchId, manufacturer, quantity)
        );
        if (!ok) assembly { revert(add(err, 32), mload(err)) }
    }
}

contract MockInventoryForSupplyChain {
    mapping(uint256 => bool) public isRecalled;
    mapping(uint256 => bool) private expired;
    mapping(address => mapping(uint256 => uint256)) private stock;

    function setRecalled(uint256 batchId, bool value) external { isRecalled[batchId] = value; }
    function setExpired(uint256 batchId, bool value) external { expired[batchId] = value; }

    function checkExpiry(uint256 batchId) external view returns (bool) { return !expired[batchId]; }

    function getFacilityStock(address facility, uint256 batchId) external view returns (uint256) {
        return stock[facility][batchId];
    }

    function updateStock(uint256 batchId, address from, address to, uint256 quantity) external {
        if (from != address(0)) stock[from][batchId] -= quantity;
        stock[to][batchId] += quantity;
    }
}
