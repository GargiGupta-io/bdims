// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title Roles
/// @notice The single source of truth for every role identifier in BDIMS.
/// @dev All three contracts import this. Never redefine a role string locally,
///      or two contracts will silently disagree about who is a pharmacy.
///
///      There is ONE admin list and it lives in DrugRegistry. SupplyChain and
///      InventoryManager check admin rights with
///      `registry.hasRole(Roles.ADMIN, msg.sender)`.
library Roles {
    /// @dev Same value as OpenZeppelin AccessControl.DEFAULT_ADMIN_ROLE.
    bytes32 internal constant ADMIN = 0x00;

    bytes32 internal constant MANUFACTURER = keccak256("MANUFACTURER_ROLE");
    bytes32 internal constant DISTRIBUTOR = keccak256("DISTRIBUTOR_ROLE");
    bytes32 internal constant PHARMACY = keccak256("PHARMACY_ROLE");
    bytes32 internal constant REGULATOR = keccak256("REGULATOR_ROLE");
}
