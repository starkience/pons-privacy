import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  PonsOperationJournal,
  type ResolvedPonsPrivacyRoute,
} from "@pons-privacy/sdk";
import { DepositDialog } from "./DepositDialog.js";
import type { DepositQuoteApi } from "./deposit-api.js";

const SIGNATURE = `0x${"11".repeat(65)}`;
const ROOT = "0x123";
const route: ResolvedPonsPrivacyRoute = {
  rootIdentity: {
    starknetPrivateKey: `0x${"12".repeat(32)}`,
    starknetPublicKey: "0x124",
    starknetAddress: ROOT,
    viewingKey: 1n,
  },
  transportIdentity: {
    starknetPrivateKey: `0x${"13".repeat(32)}`,
    starknetPublicKey: "0x125",
    starknetAddress: "0x126",
    viewingKey: 1n,
  },
  robinhoodExecution: {
    privateKey: `0x${"14".repeat(32)}`,
    address: "0x1111111111111111111111111111111111111111",
  },
  robinhoodExecutionAccount: "0x2222222222222222222222222222222222222222",
};

function quote(amountIn: bigint) {
  return {
    provider: "layerswap" as const,
    direction: "return-to-strk20" as const,
    sourceNetwork: "ROBINHOOD_MAINNET" as const,
    sourceAsset: "USDG" as const,
    destinationNetwork: "STARKNET_MAINNET" as const,
    destinationAsset: "USDC" as const,
    amountIn,
    expectedAmountOut: 9_600_000n,
    minAmountOut: 9_500_000n,
    feeAmount: 400_000n,
    expiresAt: Date.now() + 30_000,
    averageCompletionSeconds: 20,
    path: ["LAYERSWAP"],
  };
}

describe("private deposit workflow", () => {
  beforeEach(() => localStorage.clear());

  it("moves a completed LayerSwap output into STRK20 and journals every hash", async () => {
    const journal = await PonsOperationJournal.open(SIGNATURE);
    const api: DepositQuoteApi = {
      quote: vi.fn(async (amount) => quote(amount)),
      createDepositSwap: vi.fn(async (request) => ({
        quote: quote(request.amountIn),
        swap: {
          id: "swap-1",
          status: "user_transfer_pending" as const,
          amountIn: request.amountIn,
          sourceAddress: request.sourceAddress,
          destinationAddress: request.destinationAddress,
        },
        depositActions: [
          {
            type: "transfer" as const,
            order: 0,
            network: "ROBINHOOD_MAINNET" as const,
            token: "USDG" as const,
            tokenAddress: "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as const,
            toAddress: "0x3333333333333333333333333333333333333333" as const,
            amount: request.amountIn,
          },
        ],
      })),
      getDepositSwap: vi.fn(async () => ({
        id: "swap-1",
        status: "completed" as const,
        amountIn: 10_000_000n,
        sourceAddress: "0x4444444444444444444444444444444444444444",
        destinationAddress: ROOT,
        outputTransactionHash: "0xfunding",
        outputAmount: 9_600_000n,
      })),
    };
    const shield = vi.fn(async (_route, request) => {
      await request.onDeploymentTransactionHash?.("0xdeploy");
      await request.onPrivateRelayStart?.();
      await request.onPrivateTransactionHash?.("0xprivate");
      return "0xprivate";
    });

    render(
      <DepositDialog
        api={api}
        account="0x4444444444444444444444444444444444444444"
        walletName="MetaMask"
        privacyAccount={ROOT}
        privacyConfigured
        mainnetExecutionEnabled
        derivingPrivacy={false}
        onConnect={vi.fn()}
        onCreatePrivacy={async () => route.rootIdentity}
        onPrepareRoute={async () => route}
        onOpenJournal={async () => journal}
        onSubmitDepositActions={async () => ["0xsource"]}
        onShieldDeposit={shield}
        onClose={vi.fn()}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /review private deposit/i }),
    );
    await screen.findByText(/expected at destination/i);
    fireEvent.click(
      screen.getByRole("button", { name: /secure and save this route/i }),
    );
    await screen.findByRole("button", { name: /deposit and make private/i });
    fireEvent.click(
      screen.getByRole("button", { name: /deposit and make private/i }),
    );
    await screen.findByRole("button", { name: /refresh bridge status/i });
    fireEvent.click(
      screen.getByRole("button", { name: /refresh bridge status/i }),
    );

    await waitFor(() =>
      expect(shield).toHaveBeenCalledWith(
        route,
        expect.objectContaining({
          amount: 9_600_000n,
          fundingTransactionHash: "0xfunding",
        }),
      ),
    );
    await screen.findByText("Private USDC confirmed");
    await waitFor(async () => {
      const [operation] = await journal.list();
      expect(operation).toMatchObject({
        state: "private",
        sourceTxHash: "0xsource",
        destinationTxHash: "0xfunding",
        destinationAmount: "9600000",
        accountDeploymentTxHash: "0xdeploy",
        privateTxHash: "0xprivate",
      });
      expect(operation?.privateRelayStartedAt).toBeTypeOf("number");
    });
  });
});
