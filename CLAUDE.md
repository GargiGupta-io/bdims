# BDIMS: instructions for AI assistants

Blockchain-Based Drug Inventory Management System. A university group project
(Blockchain Technology DSE 4408, Manipal Institute of Technology): three
Solidity contracts on Hardhat 2, deployed later to Ethereum Sepolia.

## First: work out who you're helping

Each contract has one owner and one step-by-step guide. Run
`git branch --show-current`, then read the matching guide **in full** before
writing any code:

| Branch | Developer | Owns | Guide |
|---|---|---|---|
| `feat/registry` | Khush | `contracts/DrugRegistry.sol`, `test/registry.test.js` | `docs/guides/khush-drugregistry.md` |
| `feat/supplychain` | Pranav | `contracts/SupplyChain.sol`, `test/supplychain.test.js` | `docs/guides/pranav-supplychain.md` |
| `feat/inventory` | Ronit | `contracts/InventoryManager.sol`, `test/inventory.test.js` | `docs/guides/ronit-inventorymanager.md` |

On `main` or any other branch, ask the user which contract they are working
on. Gargi (project lead) owns everything else in the repo.

## Source of truth

1. `contracts/interfaces/I<Contract>.sol`: every function signature, event,
   custom error, and the **order checks must fail in**. Implement it exactly.
2. The developer's guide in `docs/guides/`: how and why, step by step.
3. `README.md`: setup, team, design decisions.

If the guide and the interface disagree, the interface wins. If the interface
itself looks wrong, **stop and tell the user to raise it with Gargi**. Do not
work around it: the other two contracts are built against it.

## Hard rules

- **Never edit** `contracts/interfaces/`, `contracts/libraries/`,
  `hardhat.config.js`, `package.json`, `package-lock.json`, `.github/`,
  `caliper/` or another developer's files. Change only the files the current
  developer owns (table above).
- **Do not add dependencies.** Everything needed (OpenZeppelin 5, Hardhat
  toolbox) is installed.
- **Use the interface's custom errors** (`revert ZeroQuantity();`), never
  `require("text")`. Tests check them with `revertedWithCustomError`.
- **Checks-effects-interactions:** finish every state change and event before
  any call to another contract. `nonReentrant` on state-changing external
  functions, as each guide specifies.
- **Never create or commit `.env`**, private keys or RPC URLs.
- **Never push to `main`.** Work on the developer's branch; merge only via a
  pull request.

## Commands

Use the npm scripts. They pass `--config hardhat.config.js` explicitly, which
avoids Hardhat picking up a stray config from a parent folder.

```bash
npm test                                   # compile + all tests
npm run compile                            # compile only
npm run coverage                           # coverage report; target 90%+ per contract
npx hardhat --config hardhat.config.js test test/registry.test.js   # one file
```

No Sepolia ETH or `.env` is needed: tests run on Hardhat's in-process chain.

## Testing against the other contracts

Use the ready-made mocks in `contracts/mocks/` (they must stay under
`contracts/`, the only folder Hardhat compiles). Each guide shows the exact
test fixture to use. Don't modify the mocks unless the developer owns them.

## Known gotchas

- Arrays returned from contracts are read-only ethers `Result` objects. Spread
  them before chai `members`/`deep.equal`: `[...(await c.getAffectedHolders(1))]`.
- An error raised inside a mock is asserted against the mock:
  `revertedWithCustomError(mockRegistry, "BatchNotFound")`.
- OpenZeppelin's `onlyRole` reverts with `AccessControlUnauthorizedAccount`.
- Batch IDs start at 1; 0 means "no batch".
- TypeScript is pinned to 5 on purpose (version 7 breaks Hardhat 2). Leave it.

## Done means

- `npm run compile` succeeds with **no warnings**
- every test listed in the developer's guide exists and passes
- `npm run coverage` shows **90%+ statements** for their contract
- only the developer's own files are in the commit (`git add <file>` by name,
  never `git add -A`)
