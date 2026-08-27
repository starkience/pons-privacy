import { describe, expect, it } from "vitest";
import { parseRelayRequest } from "./schema.js";

describe("relay request parser", () => {
  it("parses bigint fields from canonical decimal strings", () => {
    const parsed = parseRelayRequest({
      chainId: 4663,
      factory: "0x1111111111111111111111111111111111111111",
      account: "0x2222222222222222222222222222222222222222",
      owner: "0x3333333333333333333333333333333333333333",
      accountIndex: 1,
      calls: [
        {
          target: "0x4444444444444444444444444444444444444444",
          value: "0",
          data: "0x1234",
        },
      ],
      nonce: "0",
      deadline: "1900000000",
      prefund: "0",
      fee: {
        token: "0x0000000000000000000000000000000000000000",
        amount: "0",
        recipient: "0x0000000000000000000000000000000000000000",
      },
      signature: "0x",
    });
    expect(parsed.chainId).toBe(4663);
    expect(parsed.deadline).toBe(1_900_000_000n);
  });

  it("parses the bounded LayerSwap return policy context", () => {
    const parsed = parseRelayRequest({
      chainId: 4663,
      factory: "0x1111111111111111111111111111111111111111",
      account: "0x2222222222222222222222222222222222222222",
      owner: "0x3333333333333333333333333333333333333333",
      accountIndex: 1,
      calls: [
        {
          target: "0x4444444444444444444444444444444444444444",
          value: "0",
          data: "0x1234",
        },
      ],
      nonce: "0",
      deadline: "1900000000",
      prefund: "0",
      fee: {
        token: "0x0000000000000000000000000000000000000000",
        amount: "0",
        recipient: "0x0000000000000000000000000000000000000000",
      },
      signature: "0x",
      policyContext: { kind: "layerswap-return", swapId: "swap-1" },
    });
    expect(parsed.policyContext).toEqual({
      kind: "layerswap-return",
      swapId: "swap-1",
    });
  });

  it("rejects JSON numbers for uint256 fields", () => {
    expect(() =>
      parseRelayRequest({
        chainId: 4663,
        factory: "0x1111111111111111111111111111111111111111",
        account: "0x2222222222222222222222222222222222222222",
        owner: "0x3333333333333333333333333333333333333333",
        accountIndex: 1,
        calls: [],
        nonce: 0,
        deadline: "1900000000",
        prefund: "0",
        fee: {
          token: "0x0000000000000000000000000000000000000000",
          amount: "0",
          recipient: "0x0000000000000000000000000000000000000000",
        },
        signature: "0x",
      }),
    ).toThrow(/nonce must be an unsigned base-10 integer string/);
  });
});
