// Runs the whole test suite once more, saving every result as JSON for the
// developer page. Used by `npm run report`; `npm test` is unchanged.
//
//   npx hardhat --config hardhat.config.js run scripts/test-report.js

const path = require("path");
const hre = require("hardhat");

async function main() {
  const out = path.join(__dirname, "..", "reports", "tests.json");
  hre.config.mocha.reporter = "json";
  hre.config.mocha.reporterOption = { output: out };
  const failures = await hre.run("test", { noCompile: false });
  console.log(`Test results written to ${path.relative(process.cwd(), out)}`);
  // A failing suite must still produce a report, so the page can show it.
  process.exitCode = failures ? 1 : 0;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
