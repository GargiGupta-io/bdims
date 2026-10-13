import { ZeroHash, id } from "ethers";

// Same values as contracts/libraries/Roles.sol.
export const ROLES = {
  ADMIN: ZeroHash,
  MANUFACTURER: id("MANUFACTURER_ROLE"),
  DISTRIBUTOR: id("DISTRIBUTOR_ROLE"),
  PHARMACY: id("PHARMACY_ROLE"),
  REGULATOR: id("REGULATOR_ROLE"),
};

export const ROLE_LABEL = {
  [ROLES.MANUFACTURER]: "Manufacturer",
  [ROLES.DISTRIBUTOR]: "Distributor",
  [ROLES.PHARMACY]: "Pharmacy",
  [ROLES.REGULATOR]: "Regulator",
};

export const roleLabel = (hash) => ROLE_LABEL[hash] ?? "Unknown role";
