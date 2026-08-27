import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PonsPrivacyRelayer } from "./relayer.js";
import { startRelayerServer } from "./server.js";

const API_KEY = "test-relayer-api-key-with-at-least-32-bytes";
const servers: ReturnType<typeof startRelayerServer>[] = [];

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
  const relay = vi.fn();
  const server = startRelayerServer(
    { relay } as unknown as PonsPrivacyRelayer,
    0,
    { apiKey: API_KEY },
  );
  servers.push(server);
  await once(server, "listening");
  const { port } = server.address() as AddressInfo;
  return { relay, url: `http://127.0.0.1:${port}` };
}

describe("relayer HTTP authentication", () => {
  it("leaves health available without a credential", async () => {
    const { url } = await harness();
    const response = await fetch(`${url}/healthz`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      policy: "pons-v2",
    });
  });

  it("rejects relay requests without the bearer credential", async () => {
    const { relay, url } = await harness();
    const response = await fetch(`${url}/v1/relay`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(response.status).toBe(401);
    expect(relay).not.toHaveBeenCalled();
  });

  it("accepts the credential before parsing the request", async () => {
    const { url } = await harness();
    const response = await fetch(`${url}/v1/relay`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${API_KEY}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      broadcasted: false,
      error: "calls must be an array",
    });
  });
});
