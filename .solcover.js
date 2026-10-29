// Not project code: the mocks only exist to test each contract on its own.
module.exports = {
  skipFiles: ["mocks/"],
  // json-summary feeds the developer page (scripts/build-dev-report.js).
  istanbulReporter: ["html", "lcov", "text", "json-summary"],
};
