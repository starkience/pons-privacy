import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useEvmWallet, type Eip1193Provider } from "./evm-wallet.js";

function Harness() {
  const wallet = useEvmWallet();
  return (
    <div>
      <button type="button" onClick={() => void wallet.connect()}>
        connect
      </button>
      <output>{wallet.account ?? wallet.error ?? "idle"}</output>
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
});

function inject(provider: Eip1193Provider): void {
  Object.defineProperty(window, "ethereum", {
    configurable: true,
    value: provider,
  });
}
