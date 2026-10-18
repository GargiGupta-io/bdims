
 // SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IInventoryManager} from "./interfaces/IInventoryManager.sol";
import {IDrugRegistry} from "./interfaces/IDrugRegistry.sol";
import {Roles} from "./libraries/Roles.sol";

contract InventoryManager is IInventoryManager, ReentrancyGuard {
    uint256 public constant EXPIRY_WARNING_WINDOW = 30 days;

    IDrugRegistry public immutable registry;
    address public immutable supplyChain;

    mapping(address => mapping(uint256 => uint256)) private facilityStock;
    mapping(uint256 => bool) private recalled;
    mapping(address => mapping(uint256 => uint256)) private reorderThreshold;
    mapping(uint256 => DispenseRecord[]) private dispensingLog;
    mapping(uint256 => address[]) private holders;
    mapping(uint256 => mapping(address => uint256)) private holderSlot;

    constructor(address registry_, address supplyChain_) {
        registry = IDrugRegistry(registry_);
        supplyChain = supplyChain_;
    }

    function _addHolder(uint256 batchId, address facility) private {
        if (holderSlot[batchId][facility] != 0) return;

        holders[batchId].push(facility);
        holderSlot[batchId][facility] = holders[batchId].length;
    }

    function _removeHolder(uint256 batchId, address facility) private {
        uint256 slot = holderSlot[batchId][facility];
        if (slot == 0) return;

        address[] storage list = holders[batchId];
        address last = list[list.length - 1];

        list[slot - 1] = last;
        holderSlot[batchId][last] = slot;
        list.pop();

        delete holderSlot[batchId][facility];
    }

    function _debit(uint256 batchId, address facility, uint256 quantity) private {
        uint256 available = facilityStock[facility][batchId];

        if (available < quantity) {
            revert InsufficientStock(batchId, facility, available, quantity);
        }

        uint256 remaining = available - quantity;
        facilityStock[facility][batchId] = remaining;

        if (remaining == 0) {
            _removeHolder(batchId, facility);
        }

        uint256 threshold = reorderThreshold[facility][batchId];

        if (remaining < threshold) {
            emit LowStockAlert(batchId, facility, remaining, threshold);
        }
    }

    function _maybeWarnExpiry(uint256 batchId) private {
        uint64 expiryDate = registry.getBatchDetails(batchId).expiryDate;

        if (
            block.timestamp < expiryDate &&
            expiryDate - block.timestamp <= EXPIRY_WARNING_WINDOW
        ) {
            emit ExpiryWarning(batchId, expiryDate);
        }
    }

    function updateStock(
        uint256 batchId,
        address from,
        address to,
        uint256 quantity
    ) external override {
        if (msg.sender != supplyChain) {
            revert CallerNotSupplyChain(msg.sender);
        }

        if (quantity == 0) {
            revert ZeroQuantity();
        }

        if (from != address(0)) {
            _debit(batchId, from, quantity);
        }

        if (facilityStock[to][batchId] == 0) {
            _addHolder(batchId, to);
        }

        facilityStock[to][batchId] += quantity;

        emit StockUpdated(batchId, from, to, quantity);
        _maybeWarnExpiry(batchId);
    }

    function dispenseDrug(
        uint256 batchId,
        uint256 quantity
    ) external override nonReentrant {
        if (!registry.hasRole(Roles.PHARMACY, msg.sender)) {
            revert NotPharmacy(msg.sender);
        }

        if (quantity == 0) {
            revert ZeroQuantity();
        }

        if (recalled[batchId]) {
            revert BatchIsRecalled(batchId);
        }

        if (!checkExpiry(batchId)) {
            revert BatchIsExpired(batchId);
        }

        _debit(batchId, msg.sender, quantity);

        dispensingLog[batchId].push(
            DispenseRecord(msg.sender, quantity, uint64(block.timestamp))
        );

        emit DrugDispensed(batchId, msg.sender, quantity);
        _maybeWarnExpiry(batchId);
    }

    function flagRecall(
        uint256 batchId,
        string calldata reason
    ) external override nonReentrant {
        IDrugRegistry.Batch memory batch = registry.getBatchDetails(batchId);

        if (
            msg.sender != batch.manufacturer &&
            !registry.hasRole(Roles.REGULATOR, msg.sender)
        ) {
            revert NotAuthorisedToRecall(msg.sender);
        }

        if (recalled[batchId]) {
            revert AlreadyRecalled(batchId);
        }

        recalled[batchId] = true;

        emit BatchRecalled(batchId, msg.sender, reason);

        registry.setBatchStatus(
            batchId,
            IDrugRegistry.BatchStatus.Recalled
        );
    }

    function setReorderThreshold(
        uint256 batchId,
        uint256 threshold
    ) external override {
        reorderThreshold[msg.sender][batchId] = threshold;
    }

    function checkExpiry(
        uint256 batchId
    ) public view override returns (bool valid) {
        return block.timestamp < registry.getBatchDetails(batchId).expiryDate;
    }

    function isRecalled(
        uint256 batchId
    ) external view override returns (bool) {
        return recalled[batchId];
    }

    function getFacilityStock(
        address facility,
        uint256 batchId
    ) external view override returns (uint256) {
        return facilityStock[facility][batchId];
    }

    function getAffectedHolders(
        uint256 batchId
    ) external view override returns (address[] memory) {
        return holders[batchId];
    }

    function getDispensingLog(
        uint256 batchId
    ) external view override returns (DispenseRecord[] memory) {
        return dispensingLog[batchId];
    }

    function getReorderThreshold(
        address facility,
        uint256 batchId
    ) external view override returns (uint256) {
        return reorderThreshold[facility][batchId];
    }
}
