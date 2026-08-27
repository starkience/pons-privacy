import { describe, expect, it, vi } from "vitest";
import { NO_RELAYER_FEE, type RelayExecutionRequest } from "@pons-privacy/sdk";
import { createLaunchApi, type LaunchDraft } from "./launch-api.js";

const draft: LaunchDraft = {
  name: "Night Market",
  symbol: "NITE",
  logo: "",
  description: "",
  socials: {
    twitter: "",
    telegram: "",
    discord: "",
    website: "",
    farcaster: "",
  },
  creatorTaxBps: 0,
  buybackEnabled: false,
  launchConfigId: 0,
};
const relayRequest: RelayExecutionRequest = {
  chainId: 4663,
  factory: "0x1111111111111111111111111111111111111111",
  account: "0x2222222222222222222222222222222222222222",
  owner: "0x3333333333333333333333333333333333333333",
  accountIndex: 7,
  calls: [
    {
      target: "0x4444444444444444444444444444444444444444",
      value: 5n,
      data: "0x1234",
    },
  ],
  nonce: 0n,
  deadline: 1_900_000_000n,
  prefund: 5n,
  fee: NO_RELAYER_FEE,
  signature: `0x${"55".repeat(65)}`,
};

describe("launch application API", () => {
  it("uses the application backend with same-origin credentials", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ previewId: "preview-1" }),
    ) as unknown as typeof fetch;
    const api = createLaunchApi("https://app.example/api/", fetchImpl);

    await api.preview(draft);

    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(url).toBe("https://app.example/api/v1/launches/preview");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
    });
    expect(JSON.parse(String(init?.body))).toEqual({ draft });
  });

  it("adds an idempotency key when a reviewed launch is submitted", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ requestId: "request-1", status: "queued" }),
    ) as unknown as typeof fetch;
    const api = createLaunchApi("/api", fetchImpl);

    await api.submit(draft, "preview-1", relayRequest);

    const [, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      draft,
      previewId: "preview-1",
      idempotencyKey: "preview-1",
      relayRequest: expect.objectContaining({
        accountIndex: 7,
        nonce: "0",
        prefund: "5",
      }),
    });
  });

  it("surfaces a structured backend rejection", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ error: "Preview expired" }, { status: 409 }),
    ) as unknown as typeof fetch;
    const api = createLaunchApi("/api", fetchImpl);

    await expect(api.submit(draft, "preview-1", relayRequest)).rejects.toThrow(
      "Preview expired",
    );
  });
});
