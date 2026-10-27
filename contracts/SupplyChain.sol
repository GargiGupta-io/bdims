// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ISupplyChain} from "./interfaces/ISupplyChain.sol";
import {IDrugRegistry} from "./interfaces/IDrugRegistry.sol";
import {IInventoryManager} from "./interfaces/IInventoryManager.sol";
import {Roles} from "./libraries/Roles.sol";

/// @title SupplyChain
/// @notice Validates every handoff of a drug batch and records the custody
///         trail. Stock balances live in InventoryManager; this contract
///         decides whether a move is allowed and holds units in escrow
///         while they are in transit.
/// @dev Owner: Pranav Arora. Spec: contracts/interfaces/ISupplyChain.sol.
contract SupplyChain is ISupplyChain, ReentrancyGuard {
    /// @notice The DrugRegistry: the single list of participants, roles and admins.
    IDrugRegistry public immutable registry;

    /// @notice The InventoryManager that keeps per-facility stock. Set once after deployment.
    IInventoryManager public inventory;

    /// @dev Append-only custody history per batch. Entry 0 is the manufacture record.
    mapping(uint256 => TransferRecord[]) private custodyTrail;

    /// @dev Open transfers, keyed by batch and recipient. An entry exists when `from != address(0)`.
    mapping(uint256 => mapping(address => PendingTransfer)) private pending;

    constructor(address registry_) {
        if (registry_ == address(0)) revert ZeroAddress();
        registry = IDrugRegistry(registry_);
    }

    // ------------------------------------------------------------------ wiring

    /// @inheritdoc ISupplyChain
    function setInventoryManager(address inventoryManager) external {
        if (!registry.hasRole(Roles.ADMIN, msg.sender)) revert NotAdmin(msg.sender);
        if (inventoryManager == address(0)) revert ZeroAddress();
        if (address(inventory) != address(0)) revert AddressAlreadySet();
        inventory = IInventoryManager(inventoryManager);
    }

    // --------------------------------------------------------------- transfers

    /// @inheritdoc ISupplyChain
    function transferCustody(uint256 batchId, address to, uint256 quantity, string calldata location)
        external
        nonReentrant
    {
        validateTransfer(batchId, msg.sender, to, quantity);

        pending[batchId][to] = PendingTransfer({
            from: msg.sender,
            quantity: quantity,
            initiatedAt: uint64(block.timestamp),
            location: location
        });
        emit CustodyTransferInitiated(batchId, msg.sender, to, quantity);

        // Interaction last: sender's units move into escrow (this contract).
        inventory.updateStock(batchId, msg.sender, address(this), quantity);
    }

    /// @inheritdoc ISupplyChain
    function acceptConsignment(uint256 batchId) external nonReentrant {
        PendingTransfer memory p = pending[batchId][msg.sender];
        if (p.from == address(0)) revert NoPendingTransfer(batchId, msg.sender);
        // A batch can be recalled or expire while it is on the road.
        if (inventory.isRecalled(batchId)) revert BatchIsRecalled(batchId);
        if (!inventory.checkExpiry(batchId)) revert BatchIsExpired(batchId);

        // Delete before calling out, so a consignment can never be accepted twice.
        delete pending[batchId][msg.sender];
        custodyTrail[batchId].push(
            TransferRecord({
                from: p.from,
                to: msg.sender,
                quantity: p.quantity,
                timestamp: uint64(block.timestamp),
                location: p.location
            })
        );
        emit CustodyTransferAccepted(batchId, p.from, msg.sender, p.quantity);

        inventory.updateStock(batchId, address(this), msg.sender, p.quantity);
    }

    /// @inheritdoc ISupplyChain
    function rejectConsignment(uint256 batchId, string calldata reason) external nonReentrant {
        PendingTransfer memory p = pending[batchId][msg.sender];
        if (p.from == address(0)) revert NoPendingTransfer(batchId, msg.sender);

        // No recall or expiry checks: returning stock must always work.
        delete pending[batchId][msg.sender];
        emit TransferRejected(batchId, p.from, msg.sender, reason);

        inventory.updateStock(batchId, address(this), p.from, p.quantity);
    }

    /// @inheritdoc ISupplyChain
    function cancelTransfer(uint256 batchId, address to) external nonReentrant {
        PendingTransfer memory p = pending[batchId][to];
        // Covers both "no such transfer" and "not yours to cancel".
        if (p.from != msg.sender) revert NoPendingTransfer(batchId, to);

        delete pending[batchId][to];
        emit TransferCancelled(batchId, msg.sender, to);

        inventory.updateStock(batchId, address(this), msg.sender, p.quantity);
    }

    /// @inheritdoc ISupplyChain
    function initialiseCustody(uint256 batchId, address manufacturer, uint256 quantity) external {
        if (msg.sender != address(registry)) revert CallerNotRegistry(msg.sender);

        custodyTrail[batchId].push(
            TransferRecord({
                from: address(0),
                to: manufacturer,
                quantity: quantity,
                timestamp: uint64(block.timestamp),
                location: "Manufactured"
            })
        );
        emit CustodyInitialised(batchId, manufacturer, quantity);

        // from = address(0) tells InventoryManager this is new stock, not a move.
        inventory.updateStock(batchId, address(0), manufacturer, quantity);
    }

    // ------------------------------------------------------------------- views

    /// @inheritdoc ISupplyChain
    function getCustodyHistory(uint256 batchId) external view returns (TransferRecord[] memory) {
        return custodyTrail[batchId];
    }

    /// @inheritdoc ISupplyChain
    function getPendingTransfer(uint256 batchId, address to) external view returns (PendingTransfer memory) {
        return pending[batchId][to];
    }

    /// @inheritdoc ISupplyChain
    function hasPendingTransfer(uint256 batchId, address to) external view returns (bool) {
        return pending[batchId][to].from != address(0);
    }

    // ---------------------------------------------------------------- internal

    /// @dev Every pre-transfer rule, in the exact order the interface specifies.
    function validateTransfer(uint256 batchId, address from, address to, uint256 quantity) internal view {
        if (quantity == 0) revert ZeroQuantity();
        if (to == address(0)) revert ZeroAddress();
        if (to == from) revert SelfTransfer();
        if (!registry.isRegistered(from)) revert NotRegistered(from);
        if (!registry.isRegistered(to)) revert NotRegistered(to);

        bytes32 fromRole = _roleOf(from);
        bytes32 toRole = _roleOf(to);
        if (!_isAllowedRoute(fromRole, toRole)) revert InvalidRoute(fromRole, toRole);

        if (inventory.isRecalled(batchId)) revert BatchIsRecalled(batchId);
        if (!inventory.checkExpiry(batchId)) revert BatchIsExpired(batchId);

        uint256 available = inventory.getFacilityStock(from, batchId);
        if (available < quantity) revert InsufficientStock(batchId, available, quantity);

        if (pending[batchId][to].from != address(0)) revert TransferAlreadyPending(batchId, to);
    }

    /// @dev The participant's supply-chain role, or bytes32(0) if it has none.
    function _roleOf(address account) private view returns (bytes32) {
        if (registry.hasRole(Roles.MANUFACTURER, account)) return Roles.MANUFACTURER;
        if (registry.hasRole(Roles.DISTRIBUTOR, account)) return Roles.DISTRIBUTOR;
        if (registry.hasRole(Roles.PHARMACY, account)) return Roles.PHARMACY;
        if (registry.hasRole(Roles.REGULATOR, account)) return Roles.REGULATOR;
        return bytes32(0);
    }

    /// @dev Medicine flows downstream only:
    ///      MANUFACTURER -> DISTRIBUTOR | PHARMACY, DISTRIBUTOR -> DISTRIBUTOR | PHARMACY.
    function _isAllowedRoute(bytes32 fromRole, bytes32 toRole) private pure returns (bool) {
        bool senderOk = fromRole == Roles.MANUFACTURER || fromRole == Roles.DISTRIBUTOR;
        bool recipientOk = toRole == Roles.DISTRIBUTOR || toRole == Roles.PHARMACY;
        return senderOk && recipientOk;
    }
}
