import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import type { DepositQuoteApi } from "./deposit-api.js";
import type { LaunchApi, LaunchPreview } from "./launch-api.js";

const preview: LaunchPreview = {
  previewId: "preview-1",
  expiresAt: "2026-08-27T12:00:00Z",
  chainId: 4663,
  chainName: "Robinhood Chain",
  privacyAccount: "0x71b33d51f210498c0A69c688fEBa027EE4Cbdd6a",
  accountIndex: 0,
  ponsFactory: "0x7eD598BcEf8bd9Edd8C97A195C6d13f40801EC7e",
  accountFactory: "0x2f04549436Aeb3693E849E6C8121CA901edF7Ce4",
  pairToken: "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168",
  launchFeeWei: "500000000000000",
  launchFeeEth: "0.0005",
  creatorTaxMaximumBps: 1_000,
  economicsPinned: true,
  route: ["session", "account", "Pons"],
};

function api(): LaunchApi {
  return {
    preview: vi.fn(async () => preview),
    submit: vi.fn(async () => ({
      requestId: "request-1",
      status: "queued" as const,
      privacyAccount: preview.privacyAccount,
    })),
  };
}

function depositApi(): DepositQuoteApi {
  return {
    quote: vi.fn(async (amountIn) => ({
      provider: "layerswap" as const,
      direction: "return-to-strk20" as const,
      sourceNetwork: "ROBINHOOD_MAINNET" as const,
      sourceAsset: "USDG" as const,
      destinationNetwork: "STARKNET_MAINNET" as const,
      destinationAsset: "USDC" as const,
      amountIn,
      expectedAmountOut: amountIn - 370_000n,
      minAmountOut: amountIn - 420_000n,
      feeAmount: 370_000n,
      expiresAt: Date.now() + 30_000,
      averageCompletionSeconds: 22,
      path: ["LAYERSWAP"],
    })),
  };
}

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText("Token name"), {
    target: { value: "Night Market" },
  });
  fireEvent.change(screen.getByLabelText("Ticker"), {
    target: { value: "NITE" },
  });
}

describe("Pons Privacy launch frontend", () => {
  it("does not ask for a Starknet wallet and blocks incomplete drafts", () => {
    render(
      <App
        api={api()}
        depositApi={depositApi()}
        apiMode="demo"
        launchEnabled={false}
      />,
    );
    expect(
      screen.getByRole("button", { name: /connect wallet/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Starknet shielding/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /review launch/i }),
    ).toBeDisabled();
  });

  it("previews a valid launch but keeps mainnet submission locked", async () => {
    const launchApi = api();
    render(
      <App
        api={launchApi}
        depositApi={depositApi()}
        apiMode="demo"
        launchEnabled={false}
      />,
    );
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /review launch/i }));
    expect(
      await screen.findByRole("dialog", { name: /public and irreversible/i }),
    ).toBeInTheDocument();
    expect(launchApi.preview).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: /mainnet launch locked/i }),
    ).toBeDisabled();
    expect(screen.getByText(/intentionally disabled/i)).toBeInTheDocument();
  });

  it("submits through the injected backend only when explicitly enabled", async () => {
    const launchApi = api();
    render(
      <App
        api={launchApi}
        depositApi={depositApi()}
        apiMode="live"
        launchEnabled
      />,
    );
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: /review launch/i }));
    await screen.findByRole("dialog", { name: /public and irreversible/i });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(
      screen.getByRole("button", { name: /confirm protected launch/i }),
    );
    await waitFor(() => expect(launchApi.submit).toHaveBeenCalledOnce());
    expect(
      await screen.findByRole("dialog", { name: /protected queue/i }),
    ).toBeInTheDocument();
  });

  it("opens the LayerSwap private-deposit route", () => {
    render(
      <App
        api={api()}
        depositApi={depositApi()}
        apiMode="demo"
        launchEnabled={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^deposit/i }));
    expect(
      screen.getByRole("dialog", {
        name: /move value without exposing the root wallet/i,
      }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("LayerSwap").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("tab", { name: /fund launcher/i }),
    ).toBeInTheDocument();
  });
});
