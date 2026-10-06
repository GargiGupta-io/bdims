// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IInventoryManager
/// @notice Stock, expiry and recall. Tracks how much is where, and enforces
///         the rules about what may be dispensed.
/// @dev Owner: Ronit Rao.
///
///      Implement as:
///        contract InventoryManager is IInventoryManager, ReentrancyGuard
///        constructor(address registry, address supplyChain)
///
///      This contract is the stock LEDGER. updateStock() does bookkeeping
///      only. Transfer policy (routes, expiry, recall) belongs to SupplyChain,
///      which is the only caller of updateStock().
///
///      Recall is the headline feature of the project. flagRecall() sets one
///      flag that SupplyChain and dispenseDrug() both read, so the freeze is
///      network-wide in the same block.
interface IInventoryManager {
    // ------------------------------------------------------------------ types

    struct DispenseRecord {
        address pharmacy;
        uint256 quantity;
        uint64 timestamp;
    }

    // ----------------------------------------------------------------- events

    event StockUpdated(uint256 indexed batchId, address indexed from, address indexed to, uint256 quantity);
    event DrugDispensed(uint256 indexed batchId, address indexed pharmacy, uint256 quantity);
    event BatchRecalled(uint256 indexed batchId, address indexed issuedBy, string reason);
    event LowStockAlert(uint256 indexed batchId, address indexed facility, uint256 remaining, uint256 threshold);
    /// @dev Emitted by dispenseDrug and updateStock when the batch is within
    ///      30 days of expiry. (View functions can't emit, so checkExpiry can't.)
    event ExpiryWarning(uint256 indexed batchId, uint64 expiryDate);

    // ----------------------------------------------------------------- errors

    error CallerNotSupplyChain(address caller);
    error NotPharmacy(address caller);
    error NotAuthorisedToRecall(address caller);
    error InsufficientStock(uint256 batchId, address facility, uint256 available, uint256 requested);
    error BatchIsExpired(uint256 batchId);
    error BatchIsRecalled(uint256 batchId);
    error AlreadyRecalled(uint256 batchId);
    error ZeroQuantity();

    // ---------------------------------------------------------------- actions

    /// @notice Move `quantity` units of a batch from one account to another.
    ///         Callable ONLY by the SupplyChain contract.
    /// @dev from == address(0) means new stock (initial custody).
    ///      Otherwise debit `from` (reverts InsufficientStock) and credit `to`.
    ///      Keep the holders list in sync: add on first credit, remove when a
    ///      balance hits zero, so getAffectedHolders() is always exact.
    ///      Emits StockUpdated, plus LowStockAlert if `from` drops below its
    ///      reorder threshold.
    ///      Reverts: CallerNotSupplyChain, ZeroQuantity, InsufficientStock.
    function updateStock(uint256 batchId, address from, address to, uint256 quantity) external;

    /// @notice Dispense units to a patient. PHARMACY role only.
    /// @dev Reverts in order: NotPharmacy, ZeroQuantity, BatchIsRecalled,
    ///      BatchIsExpired, InsufficientStock.
    ///      Then debit, append a DispenseRecord, emit DrugDispensed (and
    ///      LowStockAlert / ExpiryWarning where they apply).
    function dispenseDrug(uint256 batchId, uint256 quantity) external;

    /// @notice Freeze a batch across the whole network.
    /// @dev Caller must be the batch's original manufacturer OR hold REGULATOR.
    ///      Sets the recall flag, calls registry.setBatchStatus(batchId, Recalled),
    ///      emits BatchRecalled.
    ///      Reverts: NotAuthorisedToRecall, AlreadyRecalled.
    function flagRecall(uint256 batchId, string calldata reason) external;

    /// @notice Set the low-stock level for msg.sender's own facility.
    function setReorderThreshold(uint256 batchId, uint256 threshold) external;

    // ------------------------------------------------------------------ views

    /// @return valid True if block.timestamp is still before the expiry date.
    function checkExpiry(uint256 batchId) external view returns (bool valid);

    function isRecalled(uint256 batchId) external view returns (bool);

    function getFacilityStock(address facility, uint256 batchId) external view returns (uint256);

    /// @notice Every account still holding units of this batch, including the
    ///         SupplyChain contract itself if units are in transit.
    function getAffectedHolders(uint256 batchId) external view returns (address[] memory);

    function getDispensingLog(uint256 batchId) external view returns (DispenseRecord[] memory);

    function getReorderThreshold(address facility, uint256 batchId) external view returns (uint256);
}
