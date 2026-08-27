import { describe, expect, it, vi } from "vitest";
import { hash } from "starknet";
import { AvnuPrivatePaymasterGateway } from "./private-paymaster.js";

function response(result: object): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("AVNU private paymaster client", () => {
  it("builds sponsored-private fee terms through the same-origin proxy", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          method: "paymaster_buildTransaction",
          params: {
            transaction: {
              type: "apply_action",
              apply_action: { pool_address: "0x123" },
            },
            parameters: {
              version: "0x1",
              fee_mode: {
                mode: "sponsored_private",
                pool_fee_token: "0xabc",
              },
            },
          },
        });
        return response({
          fee_action: {
            type: "withdraw",
            recipient: "0x456",
            token: "0xabc",
            amount: "3",
          },
        });
      },
    );
    const gateway = new AvnuPrivatePaymasterGateway("/v1/paymaster", fetchMock);
    await expect(gateway.buildPoolAction("0x123", "0xabc")).resolves.toEqual({
      parameters: {
        version: "0x1",
        fee_mode: {
          mode: "sponsored_private",
          pool_fee_token: "0xabc",
        },
      },
      feeAction: {
        type: "withdraw",
        recipient: "0x456",
        token: "0xabc",
        amount: 3n,
      },
    });
  });

  it("submits the proof with a normalized Starknet call and no account sender", async () => {
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body).toMatchObject({
          method: "paymaster_executeTransaction",
          params: {
            transaction: {
              type: "apply_action",
              apply_action: {
                pool_address: "0x123",
                apply_actions_call: {
                  to: "0x789",
                  selector: hash.getSelectorFromName("apply_actions"),
                  calldata: ["0x1", "0x2"],
                },
                proof: "0x3",
                proof_facts: ["0x4"],
              },
            },
          },
        });
        return response({ tracking_id: "track-1", transaction_hash: "0xfeed" });
      },
    );
    const gateway = new AvnuPrivatePaymasterGateway("/v1/paymaster", fetchMock);
    await expect(
      gateway.executePoolAction({
        poolAddress: "0x123",
        call: {
          contractAddress: "0x789",
          entrypoint: "apply_actions",
          calldata: ["1", "0x2"],
        },
        proof: "3",
        proofFacts: ["4"],
        build: {
          parameters: {
            version: "0x1",
            fee_mode: {
              mode: "sponsored_private",
              pool_fee_token: "0xabc",
            },
          },
        },
      }),
    ).resolves.toEqual({ transactionHash: "0xfeed", trackingId: "track-1" });
  });
});
