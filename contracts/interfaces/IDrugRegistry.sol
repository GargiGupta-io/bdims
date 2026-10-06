// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

/// @title IDrugRegistry
/// @notice Identity and batch registration. Answers two questions:
///         who may take part, and what exactly is this batch.
/// @dev Owner: Khush Patel. Read by SupplyChain and InventoryManager.
///
///      Implement as:
///        contract DrugRegistry is IDrugRegistry, AccessControl, ReentrancyGuard
///        constructor(address admin)   // grants Roles.ADMIN to `admin`
///
///      Roles come from contracts/libraries/Roles.sol.
///      Batch IDs start at 1, so 0 always means "no batch".
interface IDrugRegistry is IAccessControl {
    // ------------------------------------------------------------------ types

    /// @dev Expiry is never stored as a status. It is derived from
    ///      expiryDate vs block.timestamp, because a stored flag can't
    ///      flip itself when the date passes.
    enum BatchStatus {
        Active,
        Recalled
    }

    struct Participant {
        string name;
        string licenceId;
        bytes32 role;
        bool active;
    }

    struct Batch {
        uint256 batchId;
        string drugName;
        string composition;
        address manufacturer;
        uint64 mfgDate;
        uint64 expiryDate;
        uint256 quantity; // units produced. Never changes after registration.
        string ipfsHash; // CID of the QA certificate on IPFS
        BatchStatus status;
    }

    // ----------------------------------------------------------------- events

    event ParticipantRegistered(address indexed account, bytes32 indexed role, string name, string licenceId);
    event RoleAssigned(address indexed account, bytes32 indexed role);
    event ParticipantRevoked(address indexed account);
    event BatchRegistered(
        uint256 indexed batchId, address indexed manufacturer, string drugName, uint256 quantity, uint64 expiryDate
    );
    event BatchStatusChanged(uint256 indexed batchId, BatchStatus status);

    // ----------------------------------------------------------------- errors

    error AlreadyRegistered(address account);
    error NotRegistered(address account);
    error InvalidRole(bytes32 role);
    error InvalidDates(uint64 mfgDate, uint64 expiryDate);
    error ZeroQuantity();
    error EmptyField();
    error BatchNotFound(uint256 batchId);
    error CallerNotInventory(address caller);
    error AddressAlreadySet();
    error ZeroAddress();

    // ------------------------------------------------------ participant admin

    /// @notice Onboard a supply-chain actor. Admin only.
    /// @dev `role` must be MANUFACTURER, DISTRIBUTOR, PHARMACY or REGULATOR.
    ///      Must grant `role` through AccessControl so hasRole() works for
    ///      the other two contracts.
    ///      Reverts: ZeroAddress, AlreadyRegistered, InvalidRole, EmptyField.
    function registerParticipant(address account, string calldata name, string calldata licenceId, bytes32 role)
        external;

    /// @notice Change an existing participant's role. Admin only.
    /// @dev Revokes the old role, grants the new one.
    ///      Reverts: NotRegistered, InvalidRole.
    function assignRole(address account, bytes32 role) external;

    /// @notice Deactivate a participant. Admin only.
    /// @dev Sets active = false and revokes their role. Their past
    ///      transactions stay on chain untouched.
    ///      Reverts: NotRegistered.
    function revokeParticipant(address account) external;

    // ---------------------------------------------------------------- batches

    /// @notice Register a new production batch. MANUFACTURER role only.
    /// @dev Assigns the next batchId, stores the metadata, then calls
    ///      supplyChain.initialiseCustody(batchId, msg.sender, quantity)
    ///      so the manufacturer holds the full quantity immediately.
    ///      Reverts: ZeroQuantity, EmptyField (drugName or ipfsHash empty),
    ///      InvalidDates (expiryDate must be after mfgDate AND after now).
    /// @return batchId The new batch identifier.
    function registerBatch(
        string calldata drugName,
        string calldata composition,
        uint64 mfgDate,
        uint64 expiryDate,
        uint256 quantity,
        string calldata ipfsHash
    ) external returns (uint256 batchId);

    /// @notice Update a batch's status. Callable ONLY by the InventoryManager contract.
    /// @dev Used by InventoryManager.flagRecall.
    ///      Reverts: CallerNotInventory, BatchNotFound.
    function setBatchStatus(uint256 batchId, BatchStatus status) external;

    // ------------------------------------------------------------------ views

    /// @dev Reverts BatchNotFound for an unknown ID. The public verification
    ///      portal relies on this to flag forged batch IDs.
    function getBatchDetails(uint256 batchId) external view returns (Batch memory);

    function getParticipant(address account) external view returns (Participant memory);

    /// @notice True only if `account` is registered AND still active.
    function isRegistered(address account) external view returns (bool);

    function batchExists(uint256 batchId) external view returns (bool);

    /// @notice Number of batches registered so far (also the latest batchId).
    function batchCount() external view returns (uint256);

    // ----------------------------------------------------------------- wiring

    /// @notice One-time wiring, called by the deploy script. Admin only.
    /// @dev Reverts: ZeroAddress, AddressAlreadySet.
    function setSupplyChain(address supplyChain) external;

    /// @notice One-time wiring, called by the deploy script. Admin only.
    /// @dev Reverts: ZeroAddress, AddressAlreadySet.
    function setInventoryManager(address inventoryManager) external;
}
