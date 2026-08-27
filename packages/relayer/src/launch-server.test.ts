import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PonsLaunchApplication } from "./launch-application.js";
import { startLaunchServer } from "./launch-server.js";

const servers: ReturnType<typeof startLaunchServer>[] = [];
const draft = {
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
const launchAccount = {
  account: "0x2222222222222222222222222222222222222222",
  owner: "0x3333333333333333333333333333333333333333",
  accountIndex: 7,
};

afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise<void>((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve())),
          ),
      ),
  );
});

async function harness() {
  const preview = vi.fn(async () => ({
    previewId: "16692477-6f05-4d6e-aa30-4b2dd753c63d",
    expiresAt: "2026-08-27T12:10:00.000Z",
    ...launchAccount,
    privacyAccount: launchAccount.account,
    chainId: 4663,
    chainName: "Robinhood Chain" as const,
    ponsFactory: launchAccount.account,
    accountFactory: launchAccount.account,
    pairToken: launchAccount.account,
    launchFeeWei: "500000000000000",
    launchFeeEth: "0.0005",
    creatorTaxMaximumBps: 1_000,
    economicsPinned: true as const,
    fundingBalance: "10000000",
    route: ["Browser-held O2 signature"],
  }));
  const application = { preview } as unknown as PonsLaunchApplication;
  const server = startLaunchServer(application, 0, {
    allowedOrigin: "https://private.pons.family",
    submissionEnabled: false,
  });
  servers.push(server);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { preview, url: `http://127.0.0.1:${port}` };
}

describe("launch application HTTP boundary", () => {
  it("requires the same-origin application header before previewing", async () => {
    const { preview, url } = await harness();
    const response = await fetch(`${url}/v1/launches/preview`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://private.pons.family",
      },
      body: JSON.stringify({ draft, launchAccount }),
    });
    expect(response.status).toBe(403);
    expect(preview).not.toHaveBeenCalled();
  });

  it("forwards only a structured draft and funded account route", async () => {
    const { preview, url } = await harness();
    const response = await fetch(`${url}/v1/launches/preview`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://private.pons.family",
        "x-pons-request": "1",
      },
      body: JSON.stringify({ draft, launchAccount }),
    });
    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      privacyAccount: launchAccount.account,
      fundingBalance: "10000000",
    });
    expect(preview).toHaveBeenCalledWith(draft, launchAccount);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
