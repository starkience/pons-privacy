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
      type: "apply_action",
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

  it("guards and signs the atomic approve plus private deposit shape", async () => {
    const selector = hash.getSelectorFromName("approve");
    const typedData = {
      types: { StarknetDomain: [], OutsideExecution: [] },
      primaryType: "OutsideExecution",
      domain: {},
      message: {
        Calls: [
          {
            To: "0xabc",
            Selector: selector,
            Calldata: ["0x123", "100", "0"],
          },
        ],
      },
    };
    const fetchMock = vi.fn(
      async (_url: string | URL | Request, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as {
          method: string;
          params: Record<string, unknown>;
        };
        if (body.method === "paymaster_buildTransaction") {
          expect(body.params).toMatchObject({
            transaction: {
              type: "invoke_and_apply_action",
              apply_action: { pool_address: "0x123" },
              invoke: {
                user_address: "0x456",
                calls: [
                  {
                    to: "0xabc",
                    selector,
                    calldata: ["0x123", "0x64", "0x0"],
                  },
                ],
              },
            },
          });
          return response({
            typed_data: typedData,
            fee_action: {
              type: "withdraw",
              recipient: "0x777",
              token: "0xabc",
              amount: "3",
            },
          });
        }
        expect(body.params).toMatchObject({
          transaction: {
            type: "invoke_and_apply_action",
            invoke: {
              user_address: "0x456",
              typed_data: typedData,
              signature: ["0x1", "0x2"],
            },
            apply_action: {
              pool_address: "0x123",
              proof: "0x3",
              proof_facts: ["0x4"],
            },
          },
        });
        return response({ tracking_id: "track-2", transaction_hash: "0xbeef" });
      },
    );
    const gateway = new AvnuPrivatePaymasterGateway("/v1/paymaster", fetchMock);
    const approve = {
      contractAddress: "0xabc",
      entrypoint: "approve",
      calldata: ["0x123", "100", "0"],
    };
    const built = await gateway.buildInvokeAndPoolAction(
      "0x123",
      "0xabc",
      "0x456",
      [approve],
    );
    const account = { signMessage: vi.fn().mockResolvedValue(["0x1", "0x2"]) };
    const onRelayStart = vi.fn();
    await expect(
      gateway.executeInvokeAndPoolAction({
        poolAddress: "0x123",
        call: {
          contractAddress: "0x789",
          entrypoint: "apply_actions",
          calldata: ["1", "2"],
        },
        proof: "3",
        proofFacts: ["4"],
        build: built,
        account,
        onRelayStart,
      }),
    ).resolves.toEqual({ transactionHash: "0xbeef", trackingId: "track-2" });
    expect(account.signMessage).toHaveBeenCalledWith(typedData);
    expect(onRelayStart).toHaveBeenCalledOnce();
  });

  it("refuses paymaster typed data that substitutes the approved call", async () => {
    const fetchMock = vi.fn(async () =>
      response({
        typed_data: {
          types: {},
          message: {
            calls: [{ to: "0xdead", selector: "0x1", calldata: [] }],
          },
        },
      }),
    );
    const gateway = new AvnuPrivatePaymasterGateway("/v1/paymaster", fetchMock);
    const build = await gateway.buildInvokeAndPoolAction(
      "0x123",
      "0xabc",
      "0x456",
      [{ contractAddress: "0xabc", entrypoint: "approve", calldata: [] }],
    );
    const account = { signMessage: vi.fn() };
    await expect(
      gateway.executeInvokeAndPoolAction({
        poolAddress: "0x123",
        call: {
          contractAddress: "0x789",
          entrypoint: "apply_actions",
          calldata: [],
        },
        proof: "0x1",
        proofFacts: [],
        build,
        account,
      }),
    ).rejects.toThrow("refusing to sign");
    expect(account.signMessage).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
