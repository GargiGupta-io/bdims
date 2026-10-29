// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IDrugRegistry} from "./interfaces/IDrugRegistry.sol";
import {ISupplyChain} from "./interfaces/ISupplyChain.sol";
import {Roles} from "./libraries/Roles.sol";

contract DrugRegistry is IDrugRegistry, AccessControl, ReentrancyGuard {
    mapping(address => Participant) private participants;
    mapping(uint256 => Batch) private batches;

    uint256 public batchCount;
    ISupplyChain public supplyChain;
    address public inventoryManager;

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(Roles.ADMIN, admin);
    }

    // ----------------------------------------------------------------- wiring

    function setSupplyChain(address supplyChain_) external onlyRole(Roles.ADMIN) {
        if (supplyChain_ == address(0)) revert ZeroAddress();
        if (address(supplyChain) != address(0)) revert AddressAlreadySet();
        supplyChain = ISupplyChain(supplyChain_);
    }

    function setInventoryManager(address inventoryManager_) external onlyRole(Roles.ADMIN) {
        if (inventoryManager_ == address(0)) revert ZeroAddress();
        if (inventoryManager != address(0)) revert AddressAlreadySet();
        inventoryManager = inventoryManager_;
    }

    // ------------------------------------------------------ participant admin

    function registerParticipant(address account, string calldata name, string calldata licenceId, bytes32 role)
        external
        onlyRole(Roles.ADMIN)
    {
        if (account == address(0)) revert ZeroAddress();
        if (participants[account].role != bytes32(0)) revert AlreadyRegistered(account);
        if (!_isParticipantRole(role)) revert InvalidRole(role);
        if (bytes(name).length == 0 || bytes(licenceId).length == 0) revert EmptyField();

        participants[account] = Participant(name, licenceId, role, true);
        _grantRole(role, account);
        emit ParticipantRegistered(account, role, name, licenceId);
    }

    function assignRole(address account, bytes32 role) external onlyRole(Roles.ADMIN) {
        Participant storage p = participants[account];
        if (!p.active) revert NotRegistered(account);
        if (!_isParticipantRole(role)) revert InvalidRole(role);

        _revokeRole(p.role, account);
        p.role = role;
        _grantRole(role, account);
        emit RoleAssigned(account, role);
    }

    function revokeParticipant(address account) external onlyRole(Roles.ADMIN) {
        Participant storage p = participants[account];
        if (!p.active) revert NotRegistered(account);

        p.active = false;
        _revokeRole(p.role, account);
        emit ParticipantRevoked(account);
    }

    // ---------------------------------------------------------------- batches

    function registerBatch(
        string calldata drugName,
        string calldata composition,
        uint64 mfgDate,
        uint64 expiryDate,
        uint256 quantity,
        string calldata ipfsHash
    ) external onlyRole(Roles.MANUFACTURER) nonReentrant returns (uint256 batchId) {
        if (quantity == 0) revert ZeroQuantity();
        if (bytes(drugName).length == 0 || bytes(ipfsHash).length == 0) revert EmptyField();
        if (expiryDate <= mfgDate || expiryDate <= block.timestamp) revert InvalidDates(mfgDate, expiryDate);

        batchId = ++batchCount;
        batches[batchId] = Batch({
            batchId: batchId,
            drugName: drugName,
            composition: composition,
            manufacturer: msg.sender,
            mfgDate: mfgDate,
            expiryDate: expiryDate,
            quantity: quantity,
            ipfsHash: ipfsHash,
            status: BatchStatus.Active
        });
        emit BatchRegistered(batchId, msg.sender, drugName, quantity, expiryDate);

        // Interaction last: every state change above is already done.
        supplyChain.initialiseCustody(batchId, msg.sender, quantity);
    }

    function setBatchStatus(uint256 batchId, BatchStatus status) external {
        if (msg.sender != inventoryManager) revert CallerNotInventory(msg.sender);
        if (!batchExists(batchId)) revert BatchNotFound(batchId);

        batches[batchId].status = status;
        emit BatchStatusChanged(batchId, status);
    }

    // ------------------------------------------------------------------ views

    function getBatchDetails(uint256 batchId) external view returns (Batch memory) {
        if (!batchExists(batchId)) revert BatchNotFound(batchId);
        return batches[batchId];
    }

    function getParticipant(address account) external view returns (Participant memory) {
        return participants[account];
    }

    function isRegistered(address account) external view returns (bool) {
        return participants[account].active;
    }

    function batchExists(uint256 batchId) public view returns (bool) {
        return batchId > 0 && batchId <= batchCount;
    }

    function _isParticipantRole(bytes32 role) private pure returns (bool) {
        return role == Roles.MANUFACTURER || role == Roles.DISTRIBUTOR || role == Roles.PHARMACY
            || role == Roles.REGULATOR;
    }
}
