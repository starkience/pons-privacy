import { describe, expect, it } from "vitest";
import {
  PONS_PRIVACY_IDENTITY_MESSAGE,
  createPonsPrivacyIdentityMessage,
  derivePonsPrivacyIdentity,
  derivePonsPrivacyRoute,
  deriveRobinhoodExecutionAccount,
  deriveStarknetTransportAccount,
} from "./identity.js";

const SIGNATURE = `0x${"11".repeat(64)}1b`;
const OTHER_SIGNATURE = `0x${"22".repeat(64)}1c`;
const OZ_CLASS_HASH =
  "0x05b4b537eaa2399e3aa99c4e2e0208ebd6c71bc1467938cd52c798c601e43564";

describe("PrivatePons identity derivation", () => {
  it("freezes the application identity message", () => {
    expect(PONS_PRIVACY_IDENTITY_MESSAGE).toBe(
      createPonsPrivacyIdentityMessage("privatepons.app"),
    );
    expect(PONS_PRIVACY_IDENTITY_MESSAGE).toContain("Version: 1");
  });

  it("derives a deterministic Starknet account and canonical viewing key", () => {
    const first = derivePonsPrivacyIdentity(SIGNATURE, OZ_CLASS_HASH);
    const second = derivePonsPrivacyIdentity(SIGNATURE, OZ_CLASS_HASH);
    expect(second).toEqual(first);
    expect(first.starknetPrivateKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.starknetPublicKey).toMatch(/^0x[0-9a-f]+$/);
    expect(first.starknetAddress).toMatch(/^0x[0-9a-f]+$/);
    expect(first.viewingKey).toBeGreaterThan(0n);
    expect(first.viewingKey).toBeLessThan(ecHalfOrder());
  });

  it("domain-separates accounts by signature, index, and key purpose", () => {
    const identity = derivePonsPrivacyIdentity(SIGNATURE, OZ_CLASS_HASH);
    const otherIdentity = derivePonsPrivacyIdentity(
      OTHER_SIGNATURE,
      OZ_CLASS_HASH,
    );
    const account0 = deriveRobinhoodExecutionAccount(SIGNATURE, 0);
    const account1 = deriveRobinhoodExecutionAccount(SIGNATURE, 1);
    const transport0 = deriveStarknetTransportAccount(
      SIGNATURE,
      0,
      OZ_CLASS_HASH,
    );
    const transport1 = deriveStarknetTransportAccount(
      SIGNATURE,
      1,
      OZ_CLASS_HASH,
    );
    expect(otherIdentity.starknetAddress).not.toBe(identity.starknetAddress);
    expect(account1.address).not.toBe(account0.address);
    expect(account0.privateKey).not.toBe(identity.starknetPrivateKey);
    expect(transport0.starknetAddress).not.toBe(identity.starknetAddress);
    expect(transport1.starknetAddress).not.toBe(transport0.starknetAddress);
  });

  it("derives a complete S1 to S2 to R2 route from one signature", () => {
    const route = derivePonsPrivacyRoute(SIGNATURE, 7, OZ_CLASS_HASH);
    expect(route.rootIdentity).toEqual(
      derivePonsPrivacyIdentity(SIGNATURE, OZ_CLASS_HASH),
    );
    expect(route.transportIdentity).toEqual(
      deriveStarknetTransportAccount(SIGNATURE, 7, OZ_CLASS_HASH),
    );
    expect(route.robinhoodExecution).toEqual(
      deriveRobinhoodExecutionAccount(SIGNATURE, 7),
    );
  });

  it("rejects malformed signatures and unsafe indices", () => {
    expect(() => derivePonsPrivacyIdentity("0x1234", OZ_CLASS_HASH)).toThrow(
      /65-byte/,
    );
    expect(() => deriveRobinhoodExecutionAccount(SIGNATURE, -1)).toThrow(
      /non-negative/,
    );
    expect(() =>
      deriveRobinhoodExecutionAccount(SIGNATURE, Number.MAX_SAFE_INTEGER + 1),
    ).toThrow(/safe integer/);
  });
});

function ecHalfOrder(): bigint {
  return 0x800000000000011000000000000000000000000000000000000000000000001n;
}
