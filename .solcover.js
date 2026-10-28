// Not project code: the Caliper probe is a temporary benchmark stand-in, and
// the mocks only exist to test each contract on its own.
module.exports = {
  skipFiles: ["probe/", "mocks/"],
  // json-summary feeds the developer page (scripts/build-dev-report.js).
  istanbulReporter: ["html", "lcov", "text", "json-summary"],
};
