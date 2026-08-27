import { getAddress, type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import {
  PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
  PONS_V2_ROBINHOOD,
} from "./chains/robinhood.js";
import { preparePonsLaunchRelayRequest } from "./launch-request.js";
import type { ResolvedPonsPrivacyRoute } from "./identity.js";

const OWNER_KEY = `0x${"11".repeat(32)}` as Hex;
const OWNER = privateKeyToAccount(OWNER_KEY).address;
const R2 = "0x2222222222222222222222222222222222222222" as Address;
const DIGEST = `0x${"33".repeat(32)}` as Hex;
const route: ResolvedPonsPrivacyRoute = {
  rootIdentity: {
    starknetPrivateKey: `0x${"44".repeat(32)}`,
    starknetPublicKey: "0x123",
    starknetAddress: "0x456",
    viewingKey: 1n,
  },
  transportIdentity: {
    starknetPrivateKey: `0x${"55".repeat(32)}`,
    starknetPublicKey: "0x789",
    starknetAddress: "0xabc",
    viewingKey: 1n,
  },
  robinhoodExecution: { privateKey: OWNER_KEY, address: OWNER },
  robinhoodExecutionAccount: R2,
};

function client(): PublicClient {
  const reads: Record<string, unknown> = {
    computeAddress: R2,
    canLaunch: true,
    launchFee: 500_000_000_000_000n,
    maxCreatorTaxBps: 1_000n,
    getLaunchConfig: { enabled: true },
    approvedPairTokens: true,
    previewLaunchEconomics: DIGEST,
  };
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (!(functionName in reads))
        throw new Error(`unexpected ${functionName}`);
      return reads[functionName];
    }),
    getBytecode: vi.fn(async () => undefined),
  } as unknown as PublicClient;
}

describe("browser-held R2 launch request", () => {
  it("signs exact Pons launch calls with O2 without returning its key", async () => {
    const request = await preparePonsLaunchRelayRequest({
      route,
      accountIndex: 7,
      publicClient: client(),
      now: () => 1_000_000,
      intent: {
        name: "Night Market",
        symbol: "NITE",
        salt: `0x${"66".repeat(32)}`,
      },
    });
    expect(request).toMatchObject({
      chainId: 4663,
      factory: PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
      account: R2,
      owner: getAddress(OWNER),
      accountIndex: 7,
      nonce: 0n,
      deadline: 1_600n,
      prefund: 500_000_000_000_000n,
      calls: [{ target: PONS_V2_ROBINHOOD.factory }],
    });
    expect(request.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(
      JSON.stringify(request, (_, value) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ).not.toContain(OWNER_KEY);
  });

  it("rejects an R2 that is not predicted by the deployed factory", async () => {
    const mismatched = client();
    vi.mocked(mismatched.readContract).mockResolvedValueOnce(
      "0x3333333333333333333333333333333333333333" as never,
    );
    await expect(
      preparePonsLaunchRelayRequest({
        route,
        accountIndex: 7,
        publicClient: mismatched,
        intent: {
          name: "Night Market",
          symbol: "NITE",
          salt: `0x${"66".repeat(32)}`,
        },
      }),
    ).rejects.toThrow(/deployed factory/);
  });
});
