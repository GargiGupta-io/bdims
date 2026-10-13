// Not project code: the Caliper probe is a temporary benchmark stand-in, and
// the mocks only exist to test each contract on its own.
module.exports = {
  skipFiles: ["probe/", "mocks/"],
};
