// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ISupplyChain
/// @notice Custody and traceability. This is where the chain of custody
///         gets built, one validated handoff at a time.
/// @dev Owner: Pranav Arora.
///
///      Implement as:
///        contract SupplyChain is ISupplyChain, ReentrancyGuard
///        constructor(address registry)
///
///      Admin checks: registry.hasRole(Roles.ADMIN, msg.sender).
///
///      HOW STOCK MOVES. A batch can be split across many facilities, so
///      custody is tracked as stock per facility in InventoryManager, not as
///      a single "current holder". A transfer is two steps:
///
///        transferCustody   sender's units move into escrow (this contract)
///        acceptConsignment escrow moves to the recipient, trail is appended
///        rejectConsignment escrow returns to the sender
///        cancelTransfer    escrow returns to the sender
///
///      Every move goes through inventory.updateStock(batchId, from, to, qty),
///      with address(this) as the escrow account. Units in transit therefore
///      show up in getAffectedHolders() during a recall, which is correct.
///
///      ALLOWED ROUTES
///        MANUFACTURER -> DISTRIBUTOR | PHARMACY
///        DISTRIBUTOR  -> DISTRIBUTOR | PHARMACY
///      Nobody sends to a MANUFACTURER or REGULATOR. A PHARMACY never sends;
///      it dispenses through InventoryManager.
interface ISupplyChain {
    // ------------------------------------------------------------------ types

    struct TransferRecord {
        address from; // address(0) for the first record (manufacture)
        address to;
        uint256 quantity;
        uint64 timestamp; // when the recipient accepted
        string location;
    }

    struct PendingTransfer {
        address from;
        uint256 quantity;
        uint64 initiatedAt;
        string location;
    }

    // ----------------------------------------------------------------- events

    event CustodyInitialised(uint256 indexed batchId, address indexed manufacturer, uint256 quantity);
    event CustodyTransferInitiated(uint256 indexed batchId, address indexed from, address indexed to, uint256 quantity);
    event CustodyTransferAccepted(uint256 indexed batchId, address indexed from, address indexed to, uint256 quantity);
    event TransferRejected(uint256 indexed batchId, address indexed from, address indexed to, string reason);
    event TransferCancelled(uint256 indexed batchId, address indexed from, address indexed to);

    // ----------------------------------------------------------------- errors

    error CallerNotRegistry(address caller);
    error NotAdmin(address caller);
    error NotRegistered(address account);
    error InvalidRoute(bytes32 fromRole, bytes32 toRole);
    error InsufficientStock(uint256 batchId, uint256 available, uint256 requested);
    error BatchIsExpired(uint256 batchId);
    error BatchIsRecalled(uint256 batchId);
    error TransferAlreadyPending(uint256 batchId, address to);
    error NoPendingTransfer(uint256 batchId, address to);
    error SelfTransfer();
    error ZeroQuantity();
    error ZeroAddress();
    error AddressAlreadySet();

    // -------------------------------------------------------------- transfers

    /// @notice Dispatch `quantity` units of a batch to `to`.
    /// @dev All checks live in one internal validateTransfer(), in this order:
    ///      ZeroQuantity, ZeroAddress, SelfTransfer,
    ///      NotRegistered (msg.sender, then `to`), InvalidRoute,
    ///      BatchIsRecalled, BatchIsExpired, InsufficientStock,
    ///      TransferAlreadyPending (one open transfer per batch per recipient).
    ///      Then: inventory.updateStock(batchId, msg.sender, address(this), quantity).
    function transferCustody(uint256 batchId, address to, uint256 quantity, string calldata location) external;

    /// @notice Recipient confirms physical receipt. msg.sender is the recipient.
    /// @dev Reverts: NoPendingTransfer, BatchIsRecalled, BatchIsExpired.
    ///      Then: updateStock(batchId, address(this), msg.sender, qty),
    ///      append a TransferRecord, delete the pending entry.
    function acceptConsignment(uint256 batchId) external;

    /// @notice Recipient refuses a consignment. Units go back to the sender.
    /// @dev ALWAYS allowed, even for recalled or expired batches, so stock
    ///      can always be returned. Reverts only NoPendingTransfer.
    function rejectConsignment(uint256 batchId, string calldata reason) external;

    /// @notice Sender withdraws a dispatch the recipient hasn't accepted yet.
    /// @dev ALWAYS allowed. This is what stops a batch getting stuck in limbo
    ///      if a recipient never responds. Reverts only NoPendingTransfer.
    function cancelTransfer(uint256 batchId, address to) external;

    /// @notice Give the manufacturer custody of a newly registered batch.
    ///         Callable ONLY by the DrugRegistry contract.
    /// @dev Appends the first TransferRecord (from = address(0)) and calls
    ///      inventory.updateStock(batchId, address(0), manufacturer, quantity).
    ///      Reverts: CallerNotRegistry.
    function initialiseCustody(uint256 batchId, address manufacturer, uint256 quantity) external;

    // ------------------------------------------------------------------ views

    /// @notice Full ordered trail. Entry 0 is always the manufacture record.
    function getCustodyHistory(uint256 batchId) external view returns (TransferRecord[] memory);

    function getPendingTransfer(uint256 batchId, address to) external view returns (PendingTransfer memory);

    function hasPendingTransfer(uint256 batchId, address to) external view returns (bool);

    // ----------------------------------------------------------------- wiring

    /// @notice One-time wiring, called by the deploy script. Admin only.
    /// @dev Reverts: NotAdmin, ZeroAddress, AddressAlreadySet.
    function setInventoryManager(address inventoryManager) external;
}
