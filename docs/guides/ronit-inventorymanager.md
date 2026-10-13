# Ronit: building InventoryManager.sol

**Deadline: Sunday 18 October.** Contract, tests and a merged pull request.

You're building **the project's headline feature: recall**. One call to your
`flagRecall` must freeze a batch across the whole network in a single
transaction, and tell everyone exactly which facilities still hold it. Your
contract is also the **stock ledger**: how many units of each batch every
facility holds, the dispensing log, and the expiry rules that stop expired
medicine reaching a patient.

Every step below says **what** to do and **why**. Your full spec, with every
function, event, error and check order, is
`contracts/interfaces/IInventoryManager.sol`. If this guide and the interface
ever disagree, the interface wins. Tell Gargi.

**Heads up, this changed from earlier messages:** `updateStock` now takes
both a sender and a receiver: `updateStock(batchId, from, to, quantity)`.

---

## Part 0: Get set up (once, ~20 minutes)

1. **Install Node 22, Git, VS Code with the "Solidity" extension by Nomic
   Foundation, and MetaMask.**
   *Why:* all four of us must run the same Node version, or tests that pass on
   one laptop fail on another.

2. **Clone and install:**
   ```bash
   git clone https://github.com/GargiGupta-io/bdims.git
   cd bdims
   nvm use
   npm install
   npm test
   ```
   *Why:* **3 passing** means your laptop is ready. If it fails, message Gargi
   before writing anything.

3. **You do not need Sepolia ETH.** Tests run on a private blockchain Hardhat
   creates on your laptop, with 20 accounts holding 10,000 fake ETH each.

## Part 1: Make your branch

4. ```bash
   git checkout main
   git pull
   git checkout -b feat/inventory
   ```
   *Why:* `main` is protected. You work on your branch and merge through a
   pull request, which runs the tests automatically.

## Part 2: Understand your role in the system

5. **Read `contracts/interfaces/IInventoryManager.sol` top to bottom.**

6. **Your contract is the ledger. It does not decide whether a transfer is allowed.**
   Pranav's `SupplyChain` checks the rules (routes, recall, expiry, enough
   stock) and then calls your `updateStock` to move the numbers. So
   `updateStock` does **bookkeeping only**: no recall or expiry checks.
   *Why:* when a batch is recalled, stock still has to flow **back** to the
   manufacturer through rejections and cancellations. If `updateStock` refused
   recalled batches, recalled stock would be stuck forever. Rules live in one
   contract, numbers in the other.

7. **You build last, but you don't wait.** Your contract calls into Khush's
   (for roles, expiry dates, and to mark a batch recalled), and only Pranav's
   contract calls yours. You'll test with a ready-made mock of Khush's
   contract, and a plain test account pretending to be Pranav's.

## Part 3: Create the contract skeleton

8. **Create `contracts/InventoryManager.sol`:**
   ```solidity
   // SPDX-License-Identifier: MIT
   pragma solidity ^0.8.24;

   import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
   import {IInventoryManager} from "./interfaces/IInventoryManager.sol";
   import {IDrugRegistry} from "./interfaces/IDrugRegistry.sol";
   import {Roles} from "./libraries/Roles.sol";

   contract InventoryManager is IInventoryManager, ReentrancyGuard {
       uint256 public constant EXPIRY_WARNING_WINDOW = 30 days;
   }
   ```
   *Why a named constant:* "30 days" appears in two places and in the
   synopsis. A name makes it obvious and easy to change.

9. **Run `npx hardhat compile`.** The errors list every function you still need.

## Part 4: State variables

10. | Variable | Type | Why |
    |---|---|---|
    | `registry` | `IDrugRegistry public immutable` | Roles, expiry dates, and where to mark recalls |
    | `supplyChain` | `address public immutable` | The only address allowed to call `updateStock` |
    | `facilityStock` | `mapping(address => mapping(uint256 => uint256)) private` | Facility → batch → units held |
    | `recalled` | `mapping(uint256 => bool) private` | The recall flag. One bool that freezes everything |
    | `reorderThreshold` | `mapping(address => mapping(uint256 => uint256)) private` | Facility → batch → low-stock level |
    | `dispensingLog` | `mapping(uint256 => DispenseRecord[]) private` | Audit record of every dispense |
    | `holders` | `mapping(uint256 => address[]) private` | Everyone with stock of a batch. This is what recall returns |
    | `holderSlot` | `mapping(uint256 => mapping(address => uint256)) private` | Each holder's position in `holders`, **plus one**. 0 means "not a holder" |

    *Why `holderSlot`:* to remove someone from `holders` without looping
    through the whole array (loops cost gas and can run out of it). Storing
    position + 1 lets 0 safely mean "not in the list".

## Part 5: Constructor

11. **`constructor(address registry_, address supplyChain_)`:** store both.
    *Why both in the constructor:* Pranav's contract is deployed before yours,
    so its address is already known. `immutable` means nobody can ever repoint
    your ledger.

## Part 6: Private helpers first

12. **`_addHolder(batchId, facility)`:** push onto `holders[batchId]` and set
    `holderSlot[batchId][facility] = holders[batchId].length`.

13. **`_removeHolder(batchId, facility)`:** the **swap-and-pop** trick:
    ```solidity
    uint256 slot = holderSlot[batchId][facility];
    address[] storage list = holders[batchId];
    address last = list[list.length - 1];
    list[slot - 1] = last;              // move the last holder into the gap
    holderSlot[batchId][last] = slot;   // update its recorded position
    list.pop();                         // drop the now-duplicate last entry
    delete holderSlot[batchId][facility];
    ```
    *Why:* constant cost no matter how many holders there are. Order doesn't
    matter for a recall list, so moving the last element is fine.

14. **`_debit(batchId, facility, quantity)`:**
    1. if `facilityStock[facility][batchId] < quantity` → `InsufficientStock(batchId, facility, available, quantity)`
    2. subtract, and if the remainder is 0 call `_removeHolder`
    3. if the remainder is **below** that facility's threshold → emit `LowStockAlert(batchId, facility, remaining, threshold)`

    *Why check explicitly:* Solidity 0.8 would revert on underflow anyway, but
    with an unreadable error. Yours tells the user exactly what they had and
    what they asked for. *Why remove at zero:* so `getAffectedHolders` is
    exact. A recall must never send inspectors to a facility with nothing left.

15. **`_maybeWarnExpiry(batchId)`:** read `registry.getBatchDetails(batchId).expiryDate`.
    If it's still in the future but within `EXPIRY_WARNING_WINDOW` → emit `ExpiryWarning`.
    *Why a helper:* both `updateStock` and `dispenseDrug` need it. View
    functions can't emit events, so the warning fires when stock actually moves.

## Part 7: Public functions

16. **`updateStock(batchId, from, to, quantity)`**:
    1. `msg.sender != supplyChain` → `CallerNotSupplyChain`
    2. `quantity == 0` → `ZeroQuantity`
    3. if `from != address(0)`: `_debit(batchId, from, quantity)`
    4. if `to` currently holds 0: `_addHolder(batchId, to)`
    5. add to `to`'s balance
    6. emit `StockUpdated`, then `_maybeWarnExpiry(batchId)`

    *Why `from == address(0)` is special:* that's new stock arriving when a
    batch is registered, so there's nobody to debit. Pranav's contract uses its
    own address as `to`/`from` for units in transit. Treat it like any other
    holder; that's what makes in-transit stock show up during a recall.

17. **`dispenseDrug(batchId, quantity)`**, `nonReentrant`, checks in **exactly** this order:
    1. `!registry.hasRole(Roles.PHARMACY, msg.sender)` → `NotPharmacy`
    2. `quantity == 0` → `ZeroQuantity`
    3. `recalled[batchId]` → `BatchIsRecalled`
    4. `!checkExpiry(batchId)` → `BatchIsExpired`
    5. insufficient stock → `InsufficientStock` (from `_debit`)

    Then `_debit`, push a `DispenseRecord(msg.sender, quantity, now)`, emit
    `DrugDispensed`, and `_maybeWarnExpiry`.
    *Why this is the important one:* this is the moment medicine reaches a
    patient. Outcome 2 of the synopsis promises the **contract itself** refuses
    expired or recalled stock here, instead of trusting someone to read the
    label.

18. **`flagRecall(batchId, reason)`**, `nonReentrant`:
    1. `b = registry.getBatchDetails(batchId)`. This reverts `BatchNotFound` for unknown IDs, which is what we want
    2. caller is neither `b.manufacturer` nor a REGULATOR (`registry.hasRole`) → `NotAuthorisedToRecall`
    3. already recalled → `AlreadyRecalled`
    4. `recalled[batchId] = true`
    5. emit `BatchRecalled`
    6. **last:** `registry.setBatchStatus(batchId, IDrugRegistry.BatchStatus.Recalled)`

    *Why one bool is enough:* Pranav's `transferCustody` and `acceptConsignment`
    and your `dispenseDrug` all read `isRecalled`. Set it once, and every path
    is blocked in the same block. That's outcome 3.
    *Why the registry call goes last:* checks-effects-interactions. Update your
    own state before calling another contract. Examiners look for this.
    *Why the original manufacturer or a regulator:* the maker found the defect,
    or the inspector ordered it. Nobody else should be able to freeze a competitor's stock.

19. **`setReorderThreshold(batchId, threshold)`**: store it under `msg.sender`'s own facility.

20. **Views:**
    - `checkExpiry(batchId)`: `block.timestamp < registry.getBatchDetails(batchId).expiryDate`. Make it **`public`** (not external) so `dispenseDrug` can call it.
    - `isRecalled`, `getFacilityStock(facility, batchId)`, `getAffectedHolders`, `getDispensingLog`, `getReorderThreshold`: plain reads.

21. **Compile.** No warnings.

## Part 8: Tests

22. **Create `test/inventory.test.js`**, using the ready-made mock
    `contracts/mocks/MockRegistryForInventory.sol`:
    - `setRole(role, address)` gives an address a role
    - `setBatch(batchId, manufacturer, expiryDate)` creates a batch
    - unknown batches revert with the real `BatchNotFound` error
    - `lastStatus(batchId)` shows what `flagRecall` set

    **The trick for `updateStock`:** pass a normal test account as the
    `supplyChain` constructor argument. That account can then call
    `updateStock` directly to hand out stock, exactly as Pranav's contract will.
    *Why:* you can test your whole ledger without his contract existing.

    ```js
    const { expect } = require("chai");
    const { ethers } = require("hardhat");
    const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

    const role = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
    const PHARMACY = role("PHARMACY_ROLE"), REGULATOR = role("REGULATOR_ROLE");
    const ZERO = ethers.ZeroAddress;

    async function deployFixture() {
      const [scAccount, mfg, pharm, pharm2, reg, stranger] = await ethers.getSigners();
      const registry = await ethers.deployContract("MockRegistryForInventory");
      const inv = await ethers.deployContract("InventoryManager", [await registry.getAddress(), scAccount.address]);
      const expiry = (await time.latest()) + 365 * 86400;
      await registry.setBatch(1, mfg.address, expiry);
      await registry.setRole(PHARMACY, pharm.address);
      await registry.setRole(PHARMACY, pharm2.address);
      await registry.setRole(REGULATOR, reg.address);
      // scAccount plays SupplyChain: mint 1000 to the manufacturer, move 100 to the pharmacy
      await inv.connect(scAccount).updateStock(1, ZERO, mfg.address, 1000);
      await inv.connect(scAccount).updateStock(1, mfg.address, pharm.address, 100);
      return { inv, registry, scAccount, mfg, pharm, pharm2, reg, stranger, expiry };
    }
    ```

23. **Write one `it(...)` per case:**

    | Test | Expect | Why |
    |---|---|---|
    | After the fixture | mfg 900, pharmacy 100, holders = both | Ledger basics |
    | Pharmacy dispenses 40 | stock 60, log has 1 record, `DrugDispensed` | Happy path |
    | Dispense more than held | `InsufficientStock` with exact numbers | Clear error |
    | Non-pharmacy dispenses | `NotPharmacy` | Only pharmacies give to patients |
    | Dispense 0 | `ZeroQuantity` | Input validation |
    | `time.increase(366 * 86400)`, then dispense | `BatchIsExpired` | Outcome 2: expired never reaches a patient |
    | Regulator recalls, then pharmacy dispenses | `BatchIsRecalled` | Outcome 3 |
    | Manufacturer recalls their own batch | succeeds, `lastStatus(1)` is 1 (Recalled) | Makers can recall, and the registry is told |
    | Stranger recalls | `NotAuthorisedToRecall` | Nobody else can freeze stock |
    | Recall twice | `AlreadyRecalled` | Idempotence |
    | Recall batch 42 (doesn't exist) | `revertedWithCustomError(registry, "BatchNotFound")` | Forged IDs fail |
    | Pharmacy dispenses all 100 | pharmacy disappears from `getAffectedHolders` | Recall list stays exact |
    | Holders after a middle holder hits zero | the rest are all still listed | Swap-and-pop is correct |
    | Stranger calls `updateStock` | `CallerNotSupplyChain` | Only Pranav's contract moves stock |
    | `updateStock` with quantity 0 | `ZeroQuantity` | Input validation |
    | Threshold 80, dispense down to 60 | `LowStockAlert(1, pharm, 60, 80)` | Reorder alert works |
    | Batch expiring in 10 days, then dispense | `ExpiryWarning` emitted | Advance warning works |
    | `updateStock` on a recalled batch (as scAccount) | **succeeds** | Returns must still work after a recall |

    *Testing tips:*
    - Errors: `await expect(tx).to.be.revertedWithCustomError(inv, "NotPharmacy")`. For `BatchNotFound`, the error comes from the **mock**, so pass `registry` instead of `inv`.
    - Time travel: `await time.increase(seconds)`.
    - Arrays from contracts are **read-only**. Spread them before comparing:
      `expect([...(await inv.getAffectedHolders(1))]).to.have.members([mfg.address, pharm.address])`.
      Without the spread, `members` crashes with "Cannot assign to read only property".

24. **Run `npm test`** until everything passes.

## Part 9: Coverage

25. **`npm run coverage`.** `InventoryManager.sol` must show **90% or more**
    statements. The uncovered line numbers tell you which tests are missing.
    *Why:* 90% is a promised deliverable in the synopsis.

## Part 10: Ship it

26. ```bash
    git add contracts/InventoryManager.sol test/inventory.test.js
    git commit -m "Implement InventoryManager with tests"
    git push -u origin feat/inventory
    ```
    *Why add files by name:* so you never commit something you don't own, or a `.env`.

27. **Open the pull request** (link in the push output), fill in the
    checklist, and wait for the green tick and one approval.

---

## Rules

- **Never edit `contracts/interfaces/` or `contracts/libraries/`.** Message
  Gargi if something looks wrong.
- **Only commit your two files.**
- **Use the interface's custom errors**, never `require("text")`.
- **Never commit `.env`** or any private key.

## Done when

- [ ] Compiles with no warnings
- [ ] Every test in the table passes
- [ ] `npm run coverage` shows 90%+ for `InventoryManager.sol`
- [ ] Pull request open and green on GitHub
- [ ] Merged, and Khush and Pranav told
