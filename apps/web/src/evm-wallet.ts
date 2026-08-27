import { useCallback, useEffect, useRef, useState } from "react";
import { ROBINHOOD_MAINNET_CHAIN_ID, robinhood } from "@pons-privacy/sdk";

export interface Eip1193Provider {
  request(args: {
    method: string;
    params?: readonly unknown[] | object;
  }): Promise<unknown>;
  on?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
}

interface Eip6963ProviderInfo {
  readonly uuid: string;
  readonly name: string;
  readonly icon: string;
  readonly rdns: string;
}

interface Eip6963ProviderDetail {
  readonly info: Eip6963ProviderInfo;
  readonly provider: Eip1193Provider;
}

export interface WalletOption {
  readonly id: string;
  readonly name: string;
  readonly icon?: string;
  readonly provider: Eip1193Provider;
}

export interface EvmWalletState {
  readonly wallets: readonly WalletOption[];
  readonly account: string | undefined;
  readonly walletName: string | undefined;
  readonly connecting: boolean;
  readonly error: string | undefined;
  connect(walletId?: string): Promise<void>;
  disconnect(): void;
  clearError(): void;
}

const ROBINHOOD_CHAIN_HEX = `0x${ROBINHOOD_MAINNET_CHAIN_ID.toString(16)}`;

export function useEvmWallet(): EvmWalletState {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [active, setActive] = useState<WalletOption>();
  const [account, setAccount] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string>();
  const walletsRef = useRef<WalletOption[]>([]);

  const addWallet = useCallback((wallet: WalletOption) => {
    setWallets((current) => {
      if (
        current.some(
          (candidate) =>
            candidate.id === wallet.id ||
            candidate.provider === wallet.provider,
        )
      ) {
        return current;
      }
      const next = [...current, wallet];
      walletsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    const announce = (event: Event) => {
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      if (!detail?.provider || !detail.info?.uuid) return;
      addWallet({
        id: detail.info.uuid,
        name: detail.info.name,
        icon: detail.info.icon,
        provider: detail.provider,
      });
    };
    window.addEventListener("eip6963:announceProvider", announce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));

    const legacy = (window as Window & { ethereum?: Eip1193Provider }).ethereum;
    if (legacy) {
      addWallet({ id: "injected", name: "Browser wallet", provider: legacy });
    }
    return () =>
      window.removeEventListener("eip6963:announceProvider", announce);
  }, [addWallet]);

  useEffect(() => {
    if (!active?.provider.on) return;
    const accountsChanged = (...args: unknown[]) => {
      const accounts = args[0];
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
        setAccount(undefined);
        setActive(undefined);
        return;
      }
      setAccount(accounts[0]);
    };
    active.provider.on("accountsChanged", accountsChanged);
    return () =>
      active.provider.removeListener?.("accountsChanged", accountsChanged);
  }, [active]);

  const connect = useCallback(async (walletId?: string) => {
    const available = walletsRef.current;
    const wallet = walletId
      ? available.find((candidate) => candidate.id === walletId)
      : available[0];
    if (!wallet) {
      setError(
        "No EVM wallet found. Install MetaMask, Phantom, or Robinhood Wallet.",
      );
      return;
    }
    setConnecting(true);
    setError(undefined);
    try {
      const accounts = await wallet.provider.request({
        method: "eth_requestAccounts",
      });
      if (!Array.isArray(accounts) || typeof accounts[0] !== "string") {
        throw new Error("The wallet did not return an account");
      }
      await ensureRobinhood(wallet.provider);
      setActive(wallet);
      setAccount(accounts[0]);
    } catch (cause) {
      setError(walletError(cause));
    } finally {
      setConnecting(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setActive(undefined);
    setAccount(undefined);
    setError(undefined);
  }, []);

  return {
    wallets,
    account,
    walletName: active?.name,
    connecting,
    error,
    connect,
    disconnect,
    clearError: () => setError(undefined),
  };
}

async function ensureRobinhood(provider: Eip1193Provider): Promise<void> {
  const current = await provider.request({ method: "eth_chainId" });
  if (
    typeof current === "string" &&
    current.toLowerCase() === ROBINHOOD_CHAIN_HEX
  ) {
    return;
  }
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: ROBINHOOD_CHAIN_HEX }],
    });
  } catch (cause) {
    if (providerErrorCode(cause) !== 4_902) throw cause;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: ROBINHOOD_CHAIN_HEX,
          chainName: robinhood.name,
          nativeCurrency: robinhood.nativeCurrency,
          rpcUrls: robinhood.rpcUrls.default.http,
          blockExplorerUrls: [robinhood.blockExplorers.default.url],
        },
      ],
    });
  }
}

function providerErrorCode(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return;
  const code = (value as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
}

function walletError(cause: unknown): string {
  if (providerErrorCode(cause) === 4_001) return "Wallet request cancelled";
  return cause instanceof Error
    ? cause.message
    : "Could not connect the wallet";
}
