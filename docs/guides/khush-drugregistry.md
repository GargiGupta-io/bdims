# Khush: building DrugRegistry.sol

**Deadline: Sunday 18 October.** Contract, tests and a merged pull request.

| Quick reference | |
|---|---|
| Branch | `feat/registry` |
| You create | `contracts/DrugRegistry.sol`, `test/registry.test.js` |
| Spec (source of truth) | `contracts/interfaces/IDrugRegistry.sol` |
| Contract header | `DrugRegistry is IDrugRegistry, AccessControl, ReentrancyGuard` |
| Constructor | `constructor(address admin)` |
| Mocks to test with | `MockSupplyChainForRegistry` in `contracts/mocks/` |
| Done | compiles with no warnings, every test in this guide's test table passes, 90%+ coverage, PR merged |
| Using Claude or another AI assistant? | Open the repo root so it reads `CLAUDE.md`, then point it at this guide |

You're building the contract the other two depend on. `DrugRegistry` answers two
questions for the whole system: **who is allowed to take part**, and **what
exactly is this batch**. Pranav's contract asks it "is this address registered,
and what role does it have?" before every transfer. Ronit's asks it "when does
this batch expire, and who made it?" before every dispense and recall. If yours
is late, theirs can't be tested together, so it's worth starting first.

Every step below says **what** to do and **why**. Your full spec, with every
function, event, error and check order, is
`contracts/interfaces/IDrugRegistry.sol`. If this guide and the interface ever
disagree, the interface wins. Tell Gargi.

---

## Part 0: Get set up (once, ~20 minutes)

1. **Install Node 22, Git, VS Code with the "Solidity" extension by Nomic
   Foundation, and MetaMask.**
   *Why:* all four of us must run the same Node version, or tests that pass on
   one laptop fail on another. The extension shows compile errors as you type.

2. **Clone and install:**
   ```bash
   git clone https://github.com/GargiGupta-io/bdims.git
   cd bdims
   nvm use
   npm install
   npm test
   ```
   *Why:* `npm test` compiles everything and runs the setup test. **3 passing**
   means your laptop is ready. If it fails, stop and message Gargi. Don't work
   around it, because a broken setup means your tests won't match CI.

3. **You do not need Sepolia ETH.** Hardhat starts a private blockchain on your
   laptop every time you run tests, with 20 accounts holding 10,000 fake ETH.
   *Why:* local is instant, free and resets itself. Sepolia is only for the
   final deployment, which Gargi handles.

## Part 1: Make your branch

4. ```bash
   git checkout main
   git pull
   git checkout -b feat/registry
   ```
   *Why:* `main` is protected. Nobody can push to it directly. You work on your
   own branch and merge through a pull request, which runs the tests
   automatically and gets a second pair of eyes.

## Part 2: Read your spec

5. **Read `contracts/interfaces/IDrugRegistry.sol` top to bottom, then
   `contracts/libraries/Roles.sol`.**
   *Why:* the interface is the agreement between all three contracts. Every
   function name, argument, event, error and the order checks must fail in is
   already decided. Your job is to implement it exactly, not redesign it.
   Pranav and Ronit are writing code against these exact signatures right now.

## Part 3: Create the contract skeleton

6. **Create `contracts/DrugRegistry.sol`:**
   ```solidity
   // SPDX-License-Identifier: MIT
   pragma solidity ^0.8.24;

   import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
   import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
   import {IDrugRegistry} from "./interfaces/IDrugRegistry.sol";
   import {ISupplyChain} from "./interfaces/ISupplyChain.sol";
   import {Roles} from "./libraries/Roles.sol";

   contract DrugRegistry is IDrugRegistry, AccessControl, ReentrancyGuard {
   }
   ```
   *Why:* `AccessControl` (from OpenZeppelin, an audited library) gives you
   roles and `hasRole()` for free. You never write permission logic yourself,
   because hand-written permission checks are the most common way contracts get
   broken. `ReentrancyGuard` blocks a class of attack where a contract calls
   back into you mid-function.

7. **Run `npx hardhat compile`.** It will fail with a list of functions you
   haven't written yet.
   *Why:* that list is your to-do list. When it compiles, you've implemented
   every function in the interface.

## Part 4: State variables

8. **Add these inside the contract:**

   | Variable | Type | Why |
   |---|---|---|
   | `participants` | `mapping(address => Participant) private` | One record per supply-chain actor: name, licence, role, active |
   | `batches` | `mapping(uint256 => Batch) private` | The permanent identity of each batch |
   | `batchCount` | `uint256 public` | Counts batches and gives each a new ID. Declaring it `public` makes Solidity generate a `batchCount()` getter, which **is** the interface's `batchCount()` function, so you don't write it separately |
   | `supplyChain` | `ISupplyChain public` | Where to send `initialiseCustody` when a batch is registered |
   | `inventoryManager` | `address public` | The only address allowed to call `setBatchStatus` |

## Part 5: Constructor and wiring

9. **Constructor:** `constructor(address admin)`. Revert `ZeroAddress` if it's
   zero, then `_grantRole(Roles.ADMIN, admin)`.
   *Why:* the deploy script passes the deployer's address. That account
   becomes the one admin for the whole system. Pranav's and Ronit's contracts
   ask **your** contract who the admin is, so there's exactly one admin list.

10. **`setSupplyChain(address)` and `setInventoryManager(address)`:** both
    `onlyRole(Roles.ADMIN)`. Revert `ZeroAddress` for zero, and
    `AddressAlreadySet` if already set. Then store it.
    *Why:* the three contracts need each other's addresses, but they can't all
    be deployed first. So the deploy script deploys yours, then the other two,
    then calls these once to connect them. "Only once" stops anyone pointing
    your registry at a fake contract later.

## Part 6: Functions, in this order

11. **`registerParticipant(account, name, licenceId, role)`**, `onlyRole(Roles.ADMIN)`.
    Checks in this order:
    1. `account` is zero → `ZeroAddress`
    2. already has a record (`participants[account].role != bytes32(0)`) → `AlreadyRegistered`
    3. `role` isn't MANUFACTURER, DISTRIBUTOR, PHARMACY or REGULATOR → `InvalidRole`
    4. `name` or `licenceId` empty (`bytes(name).length == 0`) → `EmptyField`

    Then store `Participant(name, licenceId, role, true)`, call
    `_grantRole(role, account)`, and emit `ParticipantRegistered`.
    *Why:* storing the role in the struct is for display, but `_grantRole` is
    what makes `hasRole()` return true. Pranav and Ronit only ever check
    `hasRole`, so forgetting `_grantRole` silently breaks both their contracts.
    Write a private helper `_isParticipantRole(bytes32)` for check 3, because
    you'll reuse it in `assignRole`.

12. **`assignRole(account, role)`**, admin only. `NotRegistered` if the account
    isn't active, `InvalidRole` if bad. Then `_revokeRole(oldRole, account)`,
    update the struct, `_grantRole(newRole, account)`, emit `RoleAssigned`.
    *Why revoke first:* otherwise the account keeps both roles. A distributor
    promoted to manufacturer must stop being a distributor.

13. **`revokeParticipant(account)`**, admin only. `NotRegistered` if not active.
    Set `active = false`, `_revokeRole(their role)`, emit `ParticipantRevoked`.
    *Why not delete the record:* their past transfers still reference them, and
    the audit trail must stay readable. A revoked participant keeps their
    record, so they can't re-register. That's intentional.

14. **`isRegistered(account)`**: return `participants[account].active`.
    *Why:* Pranav calls this before every transfer. "Registered" must mean
    "registered **and** not revoked".

15. **`registerBatch(drugName, composition, mfgDate, expiryDate, quantity, ipfsHash)`**,
    with `onlyRole(Roles.MANUFACTURER)` and `nonReentrant`. Checks in order:
    1. `quantity == 0` → `ZeroQuantity`
    2. `drugName` or `ipfsHash` empty → `EmptyField`
    3. `expiryDate <= mfgDate` **or** `expiryDate <= block.timestamp` → `InvalidDates`

    Then:
    1. `batchId = ++batchCount;` (so IDs start at **1**)
    2. store the `Batch` with `status: BatchStatus.Active` and `manufacturer: msg.sender`
    3. emit `BatchRegistered`
    4. **last**, call `supplyChain.initialiseCustody(batchId, msg.sender, quantity)`

    *Why IDs start at 1:* 0 is the default for "nothing" in Solidity, so batch
    0 must never exist. That's how a forged ID gets detected.
    *Why the external call goes last:* this is the **checks-effects-interactions**
    pattern. Finish all your own state changes before calling another contract,
    so nothing it does can see your contract half-updated. It's the core
    defence against reentrancy, and examiners look for it.
    *Why `initialiseCustody` at all:* it gives the manufacturer custody of the
    full quantity in Pranav's and Ronit's contracts, in the same transaction.

16. **`setBatchStatus(batchId, status)`**: no role modifier. Instead:
    `msg.sender != inventoryManager` → `CallerNotInventory`, unknown batch →
    `BatchNotFound`. Then set it and emit `BatchStatusChanged`.
    *Why:* only Ronit's contract may mark a batch recalled. Checking the caller's
    **address** rather than a role is right here, because it's another
    contract, not a person.

17. **Views:**
    - `batchExists(id)`: `id > 0 && id <= batchCount`. Make it `public` so you can reuse it.
    - `getBatchDetails(id)`: revert `BatchNotFound(id)` if it doesn't exist, else return it.
    - `getParticipant(account)`: return the struct.

    *Why `getBatchDetails` must revert:* the public verification page relies on
    it. A forged batch ID has to **fail**, not return an empty batch that looks
    real. That's outcome 4 of our synopsis.

18. **Compile.** `npx hardhat compile` should now succeed with no warnings.

## Part 7: Tests

19. **Create `test/registry.test.js`.** Deploy against the ready-made mock
    `contracts/mocks/MockSupplyChainForRegistry.sol`.
    *Why a mock:* your `registerBatch` calls Pranav's contract, which may not
    exist yet. The mock has just that one function and records what it was
    called with, so you can test yours alone and even check the call happened.

    ```js
    const { expect } = require("chai");
    const { ethers } = require("hardhat");
    const { loadFixture, time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

    const role = (s) => ethers.keccak256(ethers.toUtf8Bytes(s));
    const MANUFACTURER = role("MANUFACTURER_ROLE");
    const DISTRIBUTOR = role("DISTRIBUTOR_ROLE");

    async function deployFixture() {
      const [admin, mfg, dist, stranger] = await ethers.getSigners();
      const registry = await ethers.deployContract("DrugRegistry", [admin.address]);
      const mockSC = await ethers.deployContract("MockSupplyChainForRegistry");
      await registry.setSupplyChain(await mockSC.getAddress());
      await registry.registerParticipant(mfg.address, "Cipla", "MFG-001", MANUFACTURER);
      await registry.registerParticipant(dist.address, "MedDist", "DST-001", DISTRIBUTOR);
      return { registry, mockSC, admin, mfg, dist, stranger };
    }
    ```
    *Why `loadFixture`:* it deploys once, snapshots the chain, and rewinds to
    that snapshot for every test. Tests stay independent and run fast.

20. **Write one `it(...)` per case below.** Each line is a test; the reason is
    why it's worth having.

    | Test | Expect | Why |
    |---|---|---|
    | Manufacturer registers a batch | `batchCount` is 1, details match, event emitted, `mockSC.lastQuantity()` equals the quantity | The happy path, plus proof custody was handed over |
    | Second batch gets ID 2 | IDs increase | Counter logic |
    | Distributor calls `registerBatch` | `revertedWithCustomError(registry, "AccessControlUnauthorizedAccount")` | Only manufacturers create batches. This error comes from OpenZeppelin's `onlyRole` |
    | Stranger calls `registerBatch` | same error | Unregistered addresses get nothing |
    | Zero quantity | `ZeroQuantity` | Input validation |
    | Empty drug name, empty IPFS hash | `EmptyField` | A batch without a certificate can't be verified |
    | Expiry before manufacture date | `InvalidDates` | Nonsense dates |
    | Expiry already in the past | `InvalidDates` | Can't register expired stock |
    | Duplicate `registerParticipant` | `AlreadyRegistered` | One record per address |
    | Invalid role (for example `role("ADMIN_X")`) | `InvalidRole` | Only the four real roles |
    | Non-admin calls `registerParticipant` | `AccessControlUnauthorizedAccount` | Only the admin onboards |
    | `assignRole` distributor → pharmacy | `hasRole` old false, new true | Revoke-then-grant works |
    | `revokeParticipant` | `isRegistered` false, `hasRole` false | Revocation actually removes power |
    | `getBatchDetails(999)` | `BatchNotFound` with arg 999 | Outcome 4: forged IDs fail |
    | `setBatchStatus` from a stranger | `CallerNotInventory` | Only Ronit's contract can recall |
    | `setSupplyChain` twice | `AddressAlreadySet` | Wiring is one-time |

    *Testing tips:*
    - Errors: `await expect(tx).to.be.revertedWithCustomError(registry, "ZeroQuantity")`. Add `.withArgs(...)` when the error has arguments.
    - Events: `await expect(tx).to.emit(registry, "BatchRegistered").withArgs(1, mfg.address, ...)`.
    - Dates: `const now = await time.latest();` then use `now + 365 * 86400` for a year from now.
    - Arrays returned by contracts are read-only. Spread them first, `[...(await x())]`, before using `members` or `deep.equal`.

21. **Run `npm test`** until everything passes.

## Part 8: Coverage

22. **Run `npm run coverage`.** Your `DrugRegistry.sol` row must show **90% or
    more** statements.
    *Why:* 90% coverage is a promised deliverable in our synopsis. The report
    lists uncovered line numbers. Each one is a test you haven't written.

## Part 9: Ship it

23. ```bash
    git add contracts/DrugRegistry.sol test/registry.test.js
    git commit -m "Implement DrugRegistry with tests"
    git push -u origin feat/registry
    ```
    *Why add files by name:* so you never accidentally commit something you
    don't own, or a `.env` with keys in it.

24. **Open a pull request** on GitHub (the push output prints a link). Fill
    in the checklist in the description.
    *Why:* GitHub re-runs every test on a clean machine. A green tick means it
    works beyond your laptop. One approval merges it.

25. **Tell Pranav and Ronit when it's merged.**
    *Why:* that's when the three contracts can be tested together for the
    first time.

---

## Rules

- **Never edit anything in `contracts/interfaces/` or `contracts/libraries/`.**
  If something seems wrong in your interface, message Gargi. Two other
  contracts are built against it.
- **Only commit your two files** (plus the mock if you change it).
- **Use the interface's custom errors**, never `require("some text")`.
- **Never commit `.env`** or any private key.

## Done when

- [ ] `npx hardhat compile` succeeds with no warnings
- [ ] Every test in the table passes
- [ ] `npm run coverage` shows 90%+ for `DrugRegistry.sol`
- [ ] Pull request open, tests green on GitHub
- [ ] Merged, and Pranav and Ronit told
