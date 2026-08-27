import { describe, expect, it } from "vitest";
import { encodeFunctionData, getAddress } from "viem";
import {
  LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
  erc20Abi,
  layerswapReturnActionsToCalls,
  type LayerswapDepositAction,
} from "./index.js";

const RECIPIENT = "0x1111111111111111111111111111111111111111";

function action(
  overrides: Partial<LayerswapDepositAction> = {},
): LayerswapDepositAction {
  return {
    type: "transfer",
    order: 0,
    network: "ROBINHOOD_MAINNET",
    token: "USDG",
    tokenAddress: LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
    toAddress: RECIPIENT,
    amount: 30_000_000n,
    ...overrides,
  };
}

describe("LayerSwap R2 return calls", () => {
  it("builds only an exact USDG transfer when no calldata is supplied", () => {
    expect(layerswapReturnActionsToCalls([action()])).toEqual([
      {
        target: getAddress(LAYERSWAP_ROBINHOOD_USDG_ADDRESS),
        value: 0n,
        data: encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [RECIPIENT, 30_000_000n],
        }),
      },
    ]);
  });

  it("accepts provider calldata only when it is the same exact token transfer", () => {
    const calldata = encodeFunctionData({
      abi: erc20Abi,
      functionName: "transfer",
      args: [RECIPIENT, 30_000_000n],
    });
    expect(
      layerswapReturnActionsToCalls([
        action({
          toAddress: LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
          callData: calldata,
        }),
      ]),
    ).toMatchObject([
      {
        target: getAddress(LAYERSWAP_ROBINHOOD_USDG_ADDRESS),
        data: calldata,
      },
    ]);
  });

  it("rejects arbitrary provider calldata before O2 can sign it", () => {
    expect(() =>
      layerswapReturnActionsToCalls([
        action({
          toAddress: LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
          callData: "0x1234",
        }),
      ]),
    ).toThrow("not an ERC20 transfer");
  });
});
