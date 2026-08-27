import { type Address, type Hex, type PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it, vi } from "vitest";
import {
  PONS_V2_ROBINHOOD,
  preparePonsLaunchRelayRequest,
  type PonsV2LaunchIntent,
  type RelayExecutionRequest,
  type ResolvedPonsPrivacyRoute,
} from "@pons-privacy/sdk";
import { PonsLaunchApplication } from "./launch-application.js";
import { MemoryLaunchApplicationStore } from "./launch-application-store.js";

const OWNER_KEY = `0x${"11".repeat(32)}` as Hex;
const OWNER = privateKeyToAccount(OWNER_KEY).address;
const R2 = "0x2222222222222222222222222222222222222222" as Address;
const TRANSACTION_HASH = `0x${"33".repeat(32)}` as Hex;
const DIGEST = `0x${"44".repeat(32)}` as Hex;
const NOW = 1_900_000_000_000;

const route: ResolvedPonsPrivacyRoute = {
  rootIdentity: {
    starknetPrivateKey: `0x${"55".repeat(32)}`,
    starknetPublicKey: "0x123",
    starknetAddress: "0x456",
    viewingKey: 1n,
  },
  transportIdentity: {
    starknetPrivateKey: `0x${"66".repeat(32)}`,
    starknetPublicKey: "0x789",
    starknetAddress: "0xabc",
    viewingKey: 1n,
  },
  returnIdentity: {
    starknetPrivateKey: `0x${"67".repeat(32)}`,
    starknetPublicKey: "0xdef",
    starknetAddress: "0xdef",
    viewingKey: 2n,
  },
  robinhoodExecution: { privateKey: OWNER_KEY, address: OWNER },
  robinhoodExecutionAccount: R2,
};

const draft = {
  name: "Night Market",
  symbol: "NITE",
  logo: "",
  description: "A private launch",
  socials: {
    twitter: "",
    telegram: "",
    discord: "",
    website: "https://example.com",
    farcaster: "",
  },
  creatorTaxBps: 125,
  buybackEnabled: true,
  launchConfigId: 0,
} as const;

function publicClient(): PublicClient {
  const reads: Record<string, unknown> = {
    computeAddress: R2,
    balanceOf: 10_000_000n,
    canLaunch: true,
    launchFee: 500_000_000_000_000n,
    maxCreatorTaxBps: 1_000n,
    getLaunchConfig: {
      supply: 1_000_000_000n * 10n ** 18n,
      curveFeeBps: 100n,
      phantomQuote: 3_236_000_000n,
      graduationThreshold: 8_090_000_000n,
      poolFee: 0,
      tickSpacing: 200,
      enabled: true,
    },
    approvedPairTokens: true,
    previewLaunchEconomics: DIGEST,
  };
  return {
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (!(functionName in reads)) {
        throw new Error(`unexpected read ${functionName}`);
      }
      return reads[functionName];
    }),
    getBytecode: vi.fn(async () => undefined),
  } as unknown as PublicClient;
}

function intent(
  overrides: Partial<PonsV2LaunchIntent> = {},
): PonsV2LaunchIntent {
  return {
    name: draft.name,
    symbol: draft.symbol,
    logo: draft.logo,
    description: draft.description,
    socials: { ...draft.socials },
    creatorTaxBps: draft.creatorTaxBps,
    buybackEnabled: draft.buybackEnabled,
    launchConfigId: BigInt(draft.launchConfigId),
    salt: `0x${"77".repeat(32)}`,
    ...overrides,
  };
}

async function signedRequest(client: PublicClient, launchIntent = intent()) {
  return preparePonsLaunchRelayRequest({
    route,
    accountIndex: 7,
    intent: launchIntent,
    publicClient: client,
    now: () => NOW,
  });
}

async function reviewedApplication(submissionEnabled = true) {
  const client = publicClient();
  const relay = vi.fn(
    async (_request: RelayExecutionRequest) => TRANSACTION_HASH,
  );
  const application = new PonsLaunchApplication({
    publicClient: client,
    relay,
    store: new MemoryLaunchApplicationStore(),
    submissionEnabled,
    now: () => NOW,
  });
  const preview = await application.preview(draft, {
    account: R2,
    owner: OWNER,
    accountIndex: 7,
  });
  return { application, client, preview, relay };
}

describe("user-signed R2 launch application", () => {
  it("previews only a funded factory-derived R2 and relays its exact signed launch", async () => {
    const { application, client, preview, relay } = await reviewedApplication();
    expect(preview).toMatchObject({
      privacyAccount: R2,
      owner: OWNER,
      fundingBalance: "10000000",
      pairToken: PONS_V2_ROBINHOOD.usdg,
      economicsPinned: true,
    });
    const request = await signedRequest(client);

    await expect(
      application.submit({
        draft,
        previewId: preview.previewId,
        idempotencyKey: preview.previewId,
        relayRequest: request,
      }),
    ).resolves.toMatchObject({
      status: "submitted",
      privacyAccount: R2,
      transactionHash: TRANSACTION_HASH,
    });
    expect(relay).toHaveBeenCalledOnce();
  });

  it("returns the durable result when the browser retries the same reviewed launch", async () => {
    const { application, client, preview, relay } = await reviewedApplication();
    const request = await signedRequest(client);
    const input = {
      draft,
      previewId: preview.previewId,
      idempotencyKey: preview.previewId,
      relayRequest: request,
    };

    const first = await application.submit(input);
    const retry = await application.submit(input);
    expect(retry).toEqual(first);
    expect(relay).toHaveBeenCalledOnce();
  });

  it("rejects signed calldata whose launch metadata differs from the review", async () => {
    const { application, client, preview, relay } = await reviewedApplication();
    const request = await signedRequest(
      client,
      intent({ description: "Changed after review" }),
    );
    await expect(
      application.submit({
        draft,
        previewId: preview.previewId,
        idempotencyKey: preview.previewId,
        relayRequest: request,
      }),
    ).rejects.toThrow(/metadata changed after preview/);
    expect(relay).not.toHaveBeenCalled();
  });

  it("keeps all mainnet submission behind the application kill switch", async () => {
    const { application, client, preview, relay } =
      await reviewedApplication(false);
    await expect(
      application.submit({
        draft,
        previewId: preview.previewId,
        idempotencyKey: preview.previewId,
        relayRequest: await signedRequest(client),
      }),
    ).rejects.toThrow(/submission is disabled/);
    expect(relay).not.toHaveBeenCalled();
  });
});
