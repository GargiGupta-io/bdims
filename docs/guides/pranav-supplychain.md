# Pranav: building SupplyChain.sol

**Deadline: Sunday 18 October.** Contract, tests and a merged pull request.

| Quick reference | |
|---|---|
| Branch | `feat/supplychain` |
| You create | `contracts/SupplyChain.sol`, `test/supplychain.test.js` |
| Spec (source of truth) | `contracts/interfaces/ISupplyChain.sol` |
| Contract header | `SupplyChain is ISupplyChain, ReentrancyGuard` |
| Constructor | `constructor(address registry_)` |
| Mocks to test with | `MockRegistryForSupplyChain`, `MockInventoryForSupplyChain` in `contracts/mocks/` |
| Done | compiles with no warnings, every test in this guide's test table passes, 90%+ coverage, PR merged |
| Using Claude or another AI assistant? | Open the repo root so it reads `CLAUDE.md`, then point it at this guide |

You're building the heart of the system: **every handoff of a batch from one
party to another**. When a regulator asks "where has this batch been?", the
answer is your custody trail. When anyone tries an illegal move (a pharmacy
shipping stock, a recalled batch going out, someone sending stock they don't
have), your contract is the one that refuses.

Every step below says **what** to do and **why**. Your full spec, with every
function, event, error and check order, is
`contracts/interfaces/ISupplyChain.sol`. If this guide and the interface ever
disagree, the interface wins. Tell Gargi.

**Heads up, this changed from earlier messages:** `getCurrentHolder` is gone,
because one batch can now be split across many facilities. `transferCustody`
takes a `location`. And there are two new functions, `rejectConsignment` and
`cancelTransfer`.

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
   git checkout -b feat/supplychain
   ```
   *Why:* `main` is protected. You work on your branch and merge through a
   pull request, which runs the tests automatically.

## Part 2: Understand the design before you write a line

5. **Read `contracts/interfaces/ISupplyChain.sol` top to bottom.** The comment
   at the top explains the two ideas below, and they shape everything you write.

6. **Idea 1: stock lives in Ronit's contract, not yours.**
   A batch of 10,000 units can be split: 500 to one pharmacy, 300 to another.
   So "who holds it" isn't one address. It's a balance per facility, kept in
   Ronit's `InventoryManager`. **You decide whether a move is allowed. Ronit's
   contract does the bookkeeping.** Every move goes through
   `inventory.updateStock(batchId, from, to, quantity)`.
   *Why split it this way:* one contract owns the rules, one owns the numbers.
   Each can be tested and audited on its own.

7. **Idea 2: transfers use escrow.**
   - `transferCustody`: the sender's units move into **your contract's own
     address** (`address(this)`). They're "in transit".
   - `acceptConsignment`: the recipient confirms they physically received
     them. The units move from your contract to the recipient.
   - `rejectConsignment` / `cancelTransfer`: the units go back to the sender.

   *Why escrow:* without it, a sender could dispatch the same 500 units to two
   people before either accepts. Escrow takes the units out of the sender's
   balance the moment they're dispatched. Bonus: units in transit still show
   up during a recall, because your contract counts as a holder.

## Part 3: Create the contract skeleton

8. **Create `contracts/SupplyChain.sol`:**
   ```solidity
   // SPDX-License-Identifier: MIT
   pragma solidity ^0.8.24;

   import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
   import {ISupplyChain} from "./interfaces/ISupplyChain.sol";
   import {IDrugRegistry} from "./interfaces/IDrugRegistry.sol";
   import {IInventoryManager} from "./interfaces/IInventoryManager.sol";
   import {Roles} from "./libraries/Roles.sol";

   contract SupplyChain is ISupplyChain, ReentrancyGuard {
   }
   ```
   *Why no AccessControl:* you don't keep your own roles. You ask Khush's
   registry: `registry.hasRole(...)`, `registry.isRegistered(...)`. One list of
   who's who, in one place.

9. **Run `npx hardhat compile`.** The errors list every function you still need.

## Part 4: State variables

10. | Variable | Type | Why |
    |---|---|---|
    | `registry` | `IDrugRegistry public immutable` | Set once in the constructor, never changes. `immutable` makes reads cheap and makes it impossible to swap later |
    | `inventory` | `IInventoryManager public` | Set once after deployment (Ronit's contract is deployed after yours) |
    | `custodyTrail` | `mapping(uint256 => TransferRecord[]) private` | The append-only history per batch |
    | `pending` | `mapping(uint256 => mapping(address => PendingTransfer)) private` | Open transfers, keyed by batch **and** recipient |

    *Why key `pending` by recipient:* one batch can have open transfers to
    several recipients at once. "One open transfer per batch per recipient"
    is the rule. A pending entry "exists" when its `from` is not the zero address.

## Part 5: Constructor and wiring

11. **Constructor:** `constructor(address registry_)`. Revert `ZeroAddress` if
    it's zero, then store it.

12. **`setInventoryManager(address)`:** revert `NotAdmin` unless
    `registry.hasRole(Roles.ADMIN, msg.sender)`, `ZeroAddress` for zero, and
    `AddressAlreadySet` if already set.
    *Why ask the registry for admin:* there's one admin list for the whole
    system, and it's in Khush's contract. *Why only once:* so nobody can later
    point your contract at a fake inventory.

## Part 6: Helpers first

13. **`_roleOf(address) private view returns (bytes32)`:** check
    `registry.hasRole` for MANUFACTURER, DISTRIBUTOR, PHARMACY, REGULATOR in
    turn and return the first match, or `bytes32(0)`.

14. **`_isAllowedRoute(bytes32 fromRole, bytes32 toRole) private pure returns (bool)`:**
    the sender must be a MANUFACTURER or DISTRIBUTOR, and the recipient a
    DISTRIBUTOR or PHARMACY.
    *Why these routes:* medicine flows downstream only. Pharmacies dispense to
    patients, never ship. Regulators inspect and never hold stock. Nobody sends
    stock back up to a manufacturer (returns use reject/cancel instead).

15. **`validateTransfer(batchId, from, to, quantity) internal view`:** every
    pre-transfer check, in **exactly** this order:
    1. `quantity == 0` → `ZeroQuantity`
    2. `to == address(0)` → `ZeroAddress`
    3. `to == from` → `SelfTransfer`
    4. `!registry.isRegistered(from)` → `NotRegistered(from)`
    5. `!registry.isRegistered(to)` → `NotRegistered(to)`
    6. `!_isAllowedRoute(_roleOf(from), _roleOf(to))` → `InvalidRoute(fromRole, toRole)`
    7. `inventory.isRecalled(batchId)` → `BatchIsRecalled`
    8. `!inventory.checkExpiry(batchId)` → `BatchIsExpired`
    9. `inventory.getFacilityStock(from, batchId) < quantity` → `InsufficientStock(batchId, available, quantity)`
    10. pending entry already exists for `(batchId, to)` → `TransferAlreadyPending`

    *Why one function:* the synopsis promises every rule is checked in one
    place, so it's easy to audit. *Why the order matters:* when two things are
    wrong at once, the error people see must be predictable, and the tests
    check for a specific error.

## Part 7: The transfer functions

16. **`transferCustody(batchId, to, quantity, location)`**, `nonReentrant`:
    1. `validateTransfer(batchId, msg.sender, to, quantity)`
    2. store `pending[batchId][to] = PendingTransfer(msg.sender, quantity, uint64(block.timestamp), location)`
    3. emit `CustodyTransferInitiated`
    4. **last:** `inventory.updateStock(batchId, msg.sender, address(this), quantity)`

    *Why the external call last:* this is the **checks-effects-interactions**
    pattern. Write your own state before calling another contract, so it can
    never see yours half-updated. Examiners look for this.

17. **`acceptConsignment(batchId)`**, `nonReentrant`. The caller **is** the
    recipient:
    1. load `pending[batchId][msg.sender]`. If `from` is zero → `NoPendingTransfer`
    2. recalled → `BatchIsRecalled`; expired → `BatchIsExpired`
    3. `delete` the pending entry
    4. push a `TransferRecord(p.from, msg.sender, p.quantity, now, p.location)` onto the trail
    5. emit `CustodyTransferAccepted`
    6. **last:** `inventory.updateStock(batchId, address(this), msg.sender, p.quantity)`

    *Why re-check recall here:* a batch can be recalled while it's in transit.
    The recipient must not be able to take it in. They reject it instead.
    *Why delete before calling out:* so the same consignment can never be
    accepted twice.

18. **`rejectConsignment(batchId, reason)`**, `nonReentrant`: `NoPendingTransfer`
    if none. Delete it, emit `TransferRejected(batchId, p.from, msg.sender, reason)`,
    then `updateStock(batchId, address(this), p.from, p.quantity)`.
    **No recall or expiry checks.**
    *Why:* returning stock must always work, especially for a recalled batch.
    That's how recalled stock gets back to the manufacturer.

19. **`cancelTransfer(batchId, to)`**, `nonReentrant`: load
    `pending[batchId][to]`. If its `from` isn't `msg.sender`, revert
    `NoPendingTransfer`. That covers both "no such transfer" and "it's not
    yours to cancel". Delete it, emit `TransferCancelled`, then
    `updateStock(batchId, address(this), msg.sender, p.quantity)`.
    *Why:* if a recipient never responds, the sender's stock would be stuck in
    escrow forever. This is the way out.

20. **`initialiseCustody(batchId, manufacturer, quantity)`**: revert
    `CallerNotRegistry` unless `msg.sender == address(registry)`. Push the
    first record `TransferRecord(address(0), manufacturer, quantity, now, "Manufactured")`,
    emit `CustodyInitialised`, then
    `inventory.updateStock(batchId, address(0), manufacturer, quantity)`.
    *Why:* Khush's `registerBatch` calls this so a new batch's trail starts
    with its manufacture. `from = address(0)` marks "came into existence here",
    and tells Ronit's contract this is new stock, not a move.

21. **Views:** `getCustodyHistory` returns the trail array.
    `getPendingTransfer` returns the struct. `hasPendingTransfer` returns
    `pending[batchId][to].from != address(0)`.

22. **Compile.** No warnings.

## Part 8: Tests

23. **Create `test/supplychain.test.js`** using the ready-made mocks in
    `contracts/mocks/SupplyChainTestMocks.sol`:
    - `MockRegistryForSupplyChain`: `setParticipant(address, role)` makes an
      address registered with that role. `callInitialiseCustody(...)` lets the
      mock call your `initialiseCustody` **as the registry**, which is how you
      give someone starting stock.
    - `MockInventoryForSupplyChain`: tracks stock, and lets you
      `setRecalled(batchId, true)` or `setExpired(batchId, true)` on demand.

    *Why mocks:* you can test every rule without waiting for Khush and Ronit,
    and you can force situations (recalled, expired) in one line.

    ```js
    const { expect } = require("chai");
    const { ethers } = require("hardhat");
    const { loadFixture } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

    const role = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
    const MANUFACTURER = role("MANUFACTURER_ROLE"), DISTRIBUTOR = role("DISTRIBUTOR_ROLE"),
      PHARMACY = role("PHARMACY_ROLE"), REGULATOR = role("REGULATOR_ROLE");

    async function deployFixture() {
      const [admin, mfg, dist, pharm, reg, stranger] = await ethers.getSigners();
      const registry = await ethers.deployContract("MockRegistryForSupplyChain");
      const inventory = await ethers.deployContract("MockInventoryForSupplyChain");
      const sc = await ethers.deployContract("SupplyChain", [await registry.getAddress()]);
      await registry.setParticipant(admin.address, ethers.ZeroHash); // 0x00 is the admin role
      await registry.setParticipant(mfg.address, MANUFACTURER);
      await registry.setParticipant(dist.address, DISTRIBUTOR);
      await registry.setParticipant(pharm.address, PHARMACY);
      await registry.setParticipant(reg.address, REGULATOR);
      await sc.setInventoryManager(await inventory.getAddress());
      // Batch 1: the manufacturer starts with 1000 units
      await registry.callInitialiseCustody(await sc.getAddress(), 1, mfg.address, 1000);
      return { sc, registry, inventory, admin, mfg, dist, pharm, reg, stranger };
    }
    ```

24. **Write one `it(...)` per case:**

    | Test | Expect | Why |
    |---|---|---|
    | Manufacturer → distributor, distributor accepts | distributor stock 400, trail length 2, both events | Happy path |
    | Three hops: mfg → dist → dist2 → pharmacy | trail length 4, entry 0 has `from` = zero | Outcome 1 of the synopsis |
    | Accept the same consignment twice | second one `NoPendingTransfer` | No double-receiving |
    | Non-holder transfers (stock 0) | `InsufficientStock` | Can't send what you don't have |
    | Send more than held | `InsufficientStock` with the right numbers | Same, with exact arguments |
    | Transfer to an unregistered stranger | `NotRegistered` | Only known parties |
    | Pharmacy → distributor | `InvalidRoute` | Pharmacies never ship |
    | Distributor → manufacturer | `InvalidRoute` | No sending upstream |
    | To a regulator | `InvalidRoute` | Regulators don't hold stock |
    | Zero quantity / zero address / to yourself | `ZeroQuantity` / `ZeroAddress` / `SelfTransfer` | Input validation |
    | `inventory.setRecalled(1, true)`, then transfer | `BatchIsRecalled` | Outcome 3: recall freezes movement |
    | Recall while in transit, then accept | `BatchIsRecalled` | Recall catches stock on the road |
    | …then reject | succeeds, sender gets stock back | Returns always work |
    | `inventory.setExpired(1, true)`, then transfer | `BatchIsExpired` | Outcome 2 |
    | Second transfer to the same recipient while one is pending | `TransferAlreadyPending` | One open transfer per pair |
    | Sender cancels | stock back, entry gone | The way out of limbo |
    | Someone else tries to cancel | `NoPendingTransfer` | Only the sender can cancel |
    | Stranger calls `initialiseCustody` | `CallerNotRegistry` | Only the registry creates stock |
    | Non-admin calls `setInventoryManager` | `NotAdmin` | One admin list |

    *Testing tips:*
    - Errors: `await expect(tx).to.be.revertedWithCustomError(sc, "InvalidRoute")`.
    - Arrays from contracts are read-only. Spread them, `[...(await sc.getCustodyHistory(1))]`, before deep comparisons.
    - To check the escrow: `inventory.getFacilityStock(await sc.getAddress(), 1)` should equal the in-transit amount.

25. **Run `npm test`** until everything passes.

## Part 9: Coverage

26. **`npm run coverage`.** `SupplyChain.sol` must show **90% or more**
    statements. The uncovered line numbers tell you which tests are missing.
    *Why:* 90% is a promised deliverable in the synopsis.

## Part 10: Ship it

27. ```bash
    git add contracts/SupplyChain.sol test/supplychain.test.js
    git commit -m "Implement SupplyChain with tests"
    git push -u origin feat/supplychain
    ```
    *Why add files by name:* so you never commit something you don't own, or a `.env`.

28. **Open the pull request** (link in the push output), fill in the
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
- [ ] `npm run coverage` shows 90%+ for `SupplyChain.sol`
- [ ] Pull request open and green on GitHub
- [ ] Merged, and Khush and Ronit told
