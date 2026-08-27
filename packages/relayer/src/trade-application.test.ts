import { describe, expect, it, vi } from "vitest";
import {
  PONS_V2_ROBINHOOD,
  preparePonsTradeRelayRequest,
  type PonsTradeIntent,
  type RelayExecutionRequest,
  type ResolvedPonsPrivacyRoute,
} from "@pons-privacy/sdk";
import {
  getAddress,
  isAddressEqual,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MemoryTradeApplicationStore } from "./trade-application-store.js";
import { PonsTradeApplication } from "./trade-application.js";

const OWNER_KEY = `0x${"11".repeat(32)}` as Hex;
const OWNER = privateKeyToAccount(OWNER_KEY).address;
const R2 = "0x2222222222222222222222222222222222222222" as Address;
const TOKEN = "0x3333333333333333333333333333333333333333" as Address;
const CURVE = "0x4444444444444444444444444444444444444444" as Address;
const TRANSACTION_HASH = `0x${"55".repeat(32)}` as Hex;
const NOW = 1_900_000_000_000;
const BUY_AMOUNT = 100_000_000n;

const route: ResolvedPonsPrivacyRoute = {
  rootIdentity: {
    starknetPrivateKey: `0x${"66".repeat(32)}`,
    starknetPublicKey: "0x123",
    starknetAddress: "0x456",
    viewingKey: 1n,
  },
  transportIdentity: {
    starknetPrivateKey: `0x${"77".repeat(32)}`,
    starknetPublicKey: "0x789",
    starknetAddress: "0xabc",
    viewingKey: 1n,
  },
  returnIdentity: {
    starknetPrivateKey: `0x${"88".repeat(32)}`,
    starknetPublicKey: "0xdef",
    starknetAddress: "0xdef",
    viewingKey: 2n,
  },
  robinhoodExecution: { privateKey: OWNER_KEY, address: OWNER },
  robinhoodExecutionAccount: R2,
};

const launch = {
  token: TOKEN,
  curve: CURVE,
  deployer: R2,
  creatorFeeRecipient: R2,
  pairToken: PONS_V2_ROBINHOOD.usdg,
  graduationThreshold: 8_090_000_000n,
  poolFee: 0,
  tickSpacing: 200,
  creatorTaxBps: 0,
  buybackEnabled: false,
  phase: 0,
  sweptQuote: 0n,
  sweptTokens: 0n,
  sweptAt: 0n,
  exists: true,
} as const;

function publicClient(): PublicClient {
  return {
    readContract: vi.fn(
      async ({
        address,
        functionName,
      }: {
        address: Address;
        functionName: string;
      }) => {
        switch (functionName) {
          case "computeAddress":
            return R2;
          case "getLaunchedToken":
            return launch;
          case "symbol":
            return "PONS";
          case "decimals":
            return 18;
          case "balanceOf":
            return isAddressEqual(getAddress(address), TOKEN)
              ? 50n * 10n ** 18n
              : 500_000_000n;
          case "token":
            return TOKEN;
          case "pairToken":
            return PONS_V2_ROBINHOOD.usdg;
          case "factory":
            return PONS_V2_ROBINHOOD.factory;
          case "getReserves":
            return [3_236_000_000n, 1_000_000_000n * 10n ** 18n] as const;
          case "sellableTokens":
            return 714_285_714n * 10n ** 18n;
          case "feeBps":
            return 100n;
          case "creatorTaxBps":
          case "currentSnipeTaxBps":
            return 0n;
          case "readyToGraduate":
            return false;
          default:
            throw new Error(`unexpected read ${functionName}`);
        }
      },
    ),
    getBytecode: vi.fn(async () => undefined),
  } as unknown as PublicClient;
}

function buy(amount = BUY_AMOUNT): PonsTradeIntent {
  return {
    side: "buy",
    value: {
      token: TOKEN,
      curve: CURVE,
      quoteIn: amount,
      slippageBps: 100,
    },
  };
}

async function reviewedApplication(submissionEnabled = true) {
  const client = publicClient();
  const relay = vi.fn(
    async (_request: RelayExecutionRequest) => TRANSACTION_HASH,
  );
  const application = new PonsTradeApplication({
    publicClient: client,
    relay,
    store: new MemoryTradeApplicationStore(),
    submissionEnabled,
    now: () => NOW,
  });
  const preview = await application.preview({
    side: "buy",
    token: TOKEN,
    amount: BUY_AMOUNT.toString(),
    slippageBps: 100,
    account: R2,
    owner: OWNER,
    accountIndex: 7,
  });
  return { application, client, preview, relay };
}

async function signedRequest(client: PublicClient, intent = buy()) {
  return preparePonsTradeRelayRequest({
    route,
    accountIndex: 7,
    intent,
    publicClient: client,
    now: () => NOW,
  });
}

describe("user-signed private Pons trade application", () => {
  it("previews a funded factory-derived R2 and relays its exact signed buy", async () => {
    const { application, client, preview, relay } = await reviewedApplication();
    expect(preview).toMatchObject({
      side: "buy",
      account: R2,
      owner: OWNER,
      token: TOKEN,
      curve: CURVE,
      amountIn: BUY_AMOUNT.toString(),
    });
    const request = await signedRequest(client);
    await expect(
      application.submit({
        previewId: preview.previewId,
        idempotencyKey: preview.previewId,
        relayRequest: request,
      }),
    ).resolves.toMatchObject({
      status: "submitted",
      account: R2,
      transactionHash: TRANSACTION_HASH,
    });
    expect(relay).toHaveBeenCalledOnce();
  });

  it("returns the durable submission when the same signed trade is retried", async () => {
    const { application, client, preview, relay } = await reviewedApplication();
    const input = {
      previewId: preview.previewId,
      idempotencyKey: preview.previewId,
      relayRequest: await signedRequest(client),
    };
    expect(await application.submit(input)).toEqual(
      await application.submit(input),
    );
    expect(relay).toHaveBeenCalledOnce();
  });

  it("rejects signed calldata whose amount differs from the reviewed buy", async () => {
    const { application, client, preview, relay } = await reviewedApplication();
    await expect(
      application.submit({
        previewId: preview.previewId,
        idempotencyKey: preview.previewId,
        relayRequest: await signedRequest(client, buy(BUY_AMOUNT + 1n)),
      }),
    ).rejects.toThrow("changed after preview");
    expect(relay).not.toHaveBeenCalled();
  });

  it("keeps mainnet trade relay behind its own kill switch", async () => {
    const { application, client, preview, relay } =
      await reviewedApplication(false);
    await expect(
      application.submit({
        previewId: preview.previewId,
        idempotencyKey: preview.previewId,
        relayRequest: await signedRequest(client),
      }),
    ).rejects.toThrow("submission is disabled");
    expect(relay).not.toHaveBeenCalled();
  });
});
