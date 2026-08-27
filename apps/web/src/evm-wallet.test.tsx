import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  derivePonsPrivacyIdentity,
  PONS_PRIVACY_IDENTITY_MESSAGE,
} from "@pons-privacy/sdk";
import { stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { useEvmWallet, type Eip1193Provider } from "./evm-wallet.js";

const OZ_CLASS_HASH = "0x123";

function Harness() {
  const wallet = useEvmWallet();
  return (
    <div>
      <button type="button" onClick={() => void wallet.connect()}>
        connect
      </button>
      <button
        type="button"
        onClick={() => void wallet.derivePrivacyIdentity(OZ_CLASS_HASH)}
      >
        private
      </button>
      <output>{wallet.account ?? wallet.error ?? "idle"}</output>
      <output data-testid="privacy">{wallet.privacyAccount ?? "none"}</output>
    </div>
  );
}

afterEach(() => {
  Reflect.deleteProperty(window, "ethereum");
});

describe("EVM wallet connection", () => {
  it("connects an injected wallet already on Robinhood Chain", async () => {
    const account = "0x1111111111111111111111111111111111111111";
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts") return [account];
      if (method === "eth_chainId") return "0x1237";
      throw new Error(`unexpected ${method}`);
    });
    inject({ request });
    render(<Harness />);
    await waitFor(() => expect(screen.getByText("idle")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "connect" }));
    expect(await screen.findByText(account)).toBeInTheDocument();
  });

  it("requests a switch to Robinhood when needed", async () => {
    const account = "0x2222222222222222222222222222222222222222";
    const request = vi.fn(async ({ method }: { method: string }) => {
      if (method === "eth_requestAccounts") return [account];
      if (method === "eth_chainId") return "0x1";
      if (method === "wallet_switchEthereumChain") return null;
      throw new Error(`unexpected ${method}`);
    });
    inject({ request });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "connect" }));
    expect(await screen.findByText(account)).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: "0x1237" }],
    });
  });

  it("derives a user-controlled Starknet identity from one non-transaction signature", async () => {
    const signer = privateKeyToAccount(`0x${"11".repeat(32)}`);
    const signature = await signer.signMessage({
      message: PONS_PRIVACY_IDENTITY_MESSAGE,
    });
    const request = vi.fn(
      async ({
        method,
        params,
      }: {
        method: string;
        params?: readonly unknown[] | object;
      }) => {
        if (method === "eth_requestAccounts") return [signer.address];
        if (method === "eth_chainId") return "0x1237";
        if (method === "personal_sign") {
          expect(params).toEqual([
            stringToHex(PONS_PRIVACY_IDENTITY_MESSAGE),
            signer.address,
          ]);
          return signature;
        }
        throw new Error(`unexpected ${method}`);
      },
    );
    inject({ request });
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "connect" }));
    await screen.findByText(signer.address);
    fireEvent.click(screen.getByRole("button", { name: "private" }));
    const expected = derivePonsPrivacyIdentity(signature, OZ_CLASS_HASH);
    await waitFor(() =>
      expect(screen.getByTestId("privacy")).toHaveTextContent(
        expected.starknetAddress,
      ),
    );
    expect(request).toHaveBeenCalledWith({
      method: "personal_sign",
      params: [stringToHex(PONS_PRIVACY_IDENTITY_MESSAGE), signer.address],
    });
  });
});

function inject(provider: Eip1193Provider): void {
  Object.defineProperty(window, "ethereum", {
    configurable: true,
    value: provider,
  });
}
