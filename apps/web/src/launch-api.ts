import {
  PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
  PONS_V2_ROBINHOOD,
  ROBINHOOD_MAINNET_CHAIN_ID,
  relayExecutionRequestJson,
  type RelayExecutionRequest,
} from "@pons-privacy/sdk";

export interface LaunchSocials {
  twitter: string;
  telegram: string;
  discord: string;
  website: string;
  farcaster: string;
}

export interface LaunchDraft {
  name: string;
  symbol: string;
  logo: string;
  description: string;
  socials: LaunchSocials;
  creatorTaxBps: number;
  buybackEnabled: boolean;
  launchConfigId: number;
}

export interface LaunchPreview {
  previewId: string;
  expiresAt: string;
  chainId: number;
  chainName: string;
  privacyAccount: string;
  accountIndex: number;
  ponsFactory: string;
  accountFactory: string;
  pairToken: string;
  launchFeeWei: string;
  launchFeeEth: string;
  creatorTaxMaximumBps: number;
  economicsPinned: boolean;
  fundingBalance?: string;
  route: readonly string[];
}

export interface LaunchAccount {
  readonly account: string;
  readonly owner: string;
  readonly accountIndex: number;
}

export interface LaunchSubmission {
  requestId: string;
  status: "queued" | "submitted";
  privacyAccount: string;
  transactionHash?: string;
}

export interface LaunchApi {
  preview(
    draft: LaunchDraft,
    launchAccount?: LaunchAccount,
  ): Promise<LaunchPreview>;
  submit(
    draft: LaunchDraft,
    previewId: string,
    relayRequest: RelayExecutionRequest,
  ): Promise<LaunchSubmission>;
}

export function createLaunchApi(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): LaunchApi {
  const base = baseUrl.replace(/\/$/, "");
  return {
    preview: (draft, launchAccount) =>
      request<LaunchPreview>(fetchImpl, `${base}/v1/launches/preview`, {
        draft,
        launchAccount,
      }),
    submit: (draft, previewId, relayRequest) =>
      request<LaunchSubmission>(fetchImpl, `${base}/v1/launches`, {
        draft,
        previewId,
        idempotencyKey: previewId,
        relayRequest: relayExecutionRequestJson(relayRequest),
      }),
  };
}

export function createDemoLaunchApi(): LaunchApi {
  const privacyAccount = "0x71b33d51f210498c0A69c688fEBa027EE4Cbdd6a";
  return {
    async preview() {
      return {
        previewId: `demo-${randomId()}`,
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        chainId: ROBINHOOD_MAINNET_CHAIN_ID,
        chainName: "Robinhood Chain",
        privacyAccount,
        accountIndex: 0,
        ponsFactory: PONS_V2_ROBINHOOD.factory,
        accountFactory: PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
        pairToken: PONS_V2_ROBINHOOD.usdg,
        launchFeeWei: "500000000000000",
        launchFeeEth: "0.0005",
        creatorTaxMaximumBps: 1_000,
        economicsPinned: true,
        route: [
          "User-controlled private session",
          "Fresh Robinhood execution account",
          "Pons V2 launch",
        ],
      };
    },
    async submit() {
      return {
        requestId: `demo-${randomId()}`,
        status: "queued",
        privacyAccount,
      };
    },
  };
}

async function request<T>(
  fetchImpl: typeof fetch,
  url: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetchImpl(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-pons-request": "1",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    credentials: "include",
    redirect: "error",
    referrerPolicy: "no-referrer",
  });
  const payload = (await response.json().catch(() => undefined)) as
    Record<string, unknown> | undefined;
  if (!response.ok) {
    const message =
      typeof payload?.error === "string"
        ? payload.error
        : "Launch service rejected the request";
    throw new Error(message);
  }
  return payload as T;
}

function randomId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
}
