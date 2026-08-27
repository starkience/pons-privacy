import { useCallback, useEffect, useRef, useState } from "react";
import {
  derivePonsPrivacyIdentity,
  derivePonsPrivacyRoute,
  LAYERSWAP_ROBINHOOD_USDG_ADDRESS,
  PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
  PonsOperationJournal,
  PONS_PRIVACY_IDENTITY_MESSAGE,
  ponsPrivacyAccountFactoryAbi,
  ROBINHOOD_MAINNET_CHAIN_ID,
  robinhood,
  type DerivedPonsPrivacyIdentity,
  type LayerswapDepositAction,
  type ResolvedPonsPrivacyRoute,
} from "@pons-privacy/sdk";
import {
  decodeFunctionResult,
  encodeFunctionData,
  erc20Abi,
  getAddress,
  isAddress,
  recoverMessageAddress,
  stringToHex,
  type Hex,
} from "viem";

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
  readonly derivingPrivacy: boolean;
  readonly privacyAccount: string | undefined;
  readonly error: string | undefined;
  connect(walletId?: string): Promise<void>;
  derivePrivacyIdentity(
    ozAccountClassHash: string,
  ): Promise<DerivedPonsPrivacyIdentity>;
  derivePrivacyRoute(
    accountIndex: number,
    ozAccountClassHash: string,
  ): Promise<ResolvedPonsPrivacyRoute>;
  openOperationJournal(
    ozAccountClassHash: string,
  ): Promise<PonsOperationJournal>;
  submitDepositActions(
    actions: readonly LayerswapDepositAction[],
  ): Promise<readonly Hex[]>;
  disconnect(): void;
  clearError(): void;
}

const ROBINHOOD_CHAIN_HEX = `0x${ROBINHOOD_MAINNET_CHAIN_ID.toString(16)}`;

export function useEvmWallet(): EvmWalletState {
  const [wallets, setWallets] = useState<WalletOption[]>([]);
  const [active, setActive] = useState<WalletOption>();
  const [account, setAccount] = useState<string>();
  const [connecting, setConnecting] = useState(false);
  const [derivingPrivacy, setDerivingPrivacy] = useState(false);
  const [privacyAccount, setPrivacyAccount] = useState<string>();
  const [error, setError] = useState<string>();
  const walletsRef = useRef<WalletOption[]>([]);
  const identityRef = useRef<
    | {
        readonly rootAccount: string;
        readonly signature: Hex;
        readonly identity: DerivedPonsPrivacyIdentity;
      }
    | undefined
  >(undefined);
  const identityEpochRef = useRef(0);
  const identityInFlightRef = useRef<
    Promise<DerivedPonsPrivacyIdentity> | undefined
  >(undefined);

  const clearIdentity = useCallback(() => {
    identityEpochRef.current += 1;
    identityRef.current = undefined;
    identityInFlightRef.current = undefined;
    setPrivacyAccount(undefined);
  }, []);

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
        clearIdentity();
        setAccount(undefined);
        setActive(undefined);
        return;
      }
      if (accounts[0].toLowerCase() !== account?.toLowerCase()) clearIdentity();
      setAccount(accounts[0]);
    };
    active.provider.on("accountsChanged", accountsChanged);
    return () =>
      active.provider.removeListener?.("accountsChanged", accountsChanged);
  }, [account, active, clearIdentity]);

  const connect = useCallback(
    async (walletId?: string) => {
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
        if (accounts[0].toLowerCase() !== account?.toLowerCase())
          clearIdentity();
        setActive(wallet);
        setAccount(accounts[0]);
      } catch (cause) {
        setError(walletError(cause));
      } finally {
        setConnecting(false);
      }
    },
    [account, clearIdentity],
  );

  const derivePrivacyIdentity = useCallback(
    async (ozAccountClassHash: string): Promise<DerivedPonsPrivacyIdentity> => {
      if (!active || !account) {
        throw new Error("Connect an EVM wallet before creating private keys");
      }
      const cached = identityRef.current;
      if (cached?.rootAccount.toLowerCase() === account.toLowerCase()) {
        return cached.identity;
      }
      if (identityInFlightRef.current) return identityInFlightRef.current;
      const identityEpoch = identityEpochRef.current;
      setDerivingPrivacy(true);
      setError(undefined);
      const pending = (async () => {
        const signature = await active.provider.request({
          method: "personal_sign",
          params: [stringToHex(PONS_PRIVACY_IDENTITY_MESSAGE), account],
        });
        if (typeof signature !== "string") {
          throw new Error("The wallet did not return a signature");
        }
        if (identityEpoch !== identityEpochRef.current) {
          throw new Error("Wallet account changed while creating private keys");
        }
        const signer = await recoverMessageAddress({
          message: { raw: stringToHex(PONS_PRIVACY_IDENTITY_MESSAGE) },
          signature: signature as Hex,
        });
        if (signer.toLowerCase() !== account.toLowerCase()) {
          throw new Error("The privacy-key signature did not match the wallet");
        }
        const identity = derivePonsPrivacyIdentity(
          signature,
          ozAccountClassHash,
        );
        if (identityEpoch !== identityEpochRef.current) {
          throw new Error("Wallet account changed while creating private keys");
        }
        identityRef.current = {
          rootAccount: account,
          signature: signature as Hex,
          identity,
        };
        setPrivacyAccount(identity.starknetAddress);
        return identity;
      })();
      identityInFlightRef.current = pending;
      try {
        return await pending;
      } catch (cause) {
        const nextError = walletError(cause);
        if (identityEpoch === identityEpochRef.current) setError(nextError);
        throw new Error(nextError);
      } finally {
        if (identityInFlightRef.current === pending) {
          identityInFlightRef.current = undefined;
          setDerivingPrivacy(false);
        }
      }
    },
    [account, active],
  );

  const derivePrivacyRoute = useCallback(
    async (
      accountIndex: number,
      ozAccountClassHash: string,
    ): Promise<ResolvedPonsPrivacyRoute> => {
      await derivePrivacyIdentity(ozAccountClassHash);
      const session = identityRef.current;
      if (
        !session ||
        session.rootAccount.toLowerCase() !== account?.toLowerCase()
      ) {
        throw new Error("Privacy session changed before route derivation");
      }
      const route = derivePonsPrivacyRoute(
        session.signature,
        accountIndex,
        ozAccountClassHash,
      );
      if (!active)
        throw new Error("Wallet disconnected during route derivation");
      await ensureRobinhood(active.provider);
      const callData = encodeFunctionData({
        abi: ponsPrivacyAccountFactoryAbi,
        functionName: "computeAddress",
        args: [route.robinhoodExecution.address, BigInt(accountIndex)],
      });
      const raw = await active.provider.request({
        method: "eth_call",
        params: [
          {
            to: PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
            data: callData,
          },
          "latest",
        ],
      });
      if (typeof raw !== "string" || !/^0x[0-9a-fA-F]*$/.test(raw)) {
        throw new Error("Robinhood factory returned invalid account data");
      }
      const predicted = decodeFunctionResult({
        abi: ponsPrivacyAccountFactoryAbi,
        functionName: "computeAddress",
        data: raw as Hex,
      });
      if (!isAddress(predicted) || BigInt(predicted) === 0n) {
        throw new Error("Robinhood factory returned an invalid account");
      }
      return {
        ...route,
        robinhoodExecutionAccount: getAddress(predicted),
      };
    },
    [account, active, derivePrivacyIdentity],
  );

  const openOperationJournal = useCallback(
    async (ozAccountClassHash: string): Promise<PonsOperationJournal> => {
      await derivePrivacyIdentity(ozAccountClassHash);
      const session = identityRef.current;
      if (
        !session ||
        session.rootAccount.toLowerCase() !== account?.toLowerCase()
      ) {
        throw new Error("Privacy session changed before journal recovery");
      }
      return PonsOperationJournal.open(session.signature);
    },
    [account, derivePrivacyIdentity],
  );

  const submitDepositActions = useCallback(
    async (
      actions: readonly LayerswapDepositAction[],
    ): Promise<readonly Hex[]> => {
      if (!active || !account) {
        throw new Error("Connect the source wallet before depositing USDG");
      }
      if (actions.length === 0) {
        throw new Error("LayerSwap returned no deposit actions");
      }
      const hashes: Hex[] = [];
      for (const [index, action] of [...actions]
        .sort((left, right) => left.order - right.order)
        .entries()) {
        if (
          action.order !== index ||
          action.network !== "ROBINHOOD_MAINNET" ||
          action.token !== "USDG" ||
          action.tokenAddress.toLowerCase() !==
            LAYERSWAP_ROBINHOOD_USDG_ADDRESS.toLowerCase()
        ) {
          throw new Error("LayerSwap action changed the pinned USDG route");
        }
        if (action.type === "sign") {
          throw new Error("LayerSwap gasless signing has not been allowlisted");
        }
        const data =
          action.callData ??
          encodeFunctionData({
            abi: erc20Abi,
            functionName: "transfer",
            args: [action.toAddress, action.amount],
          });
        const submitted = await active.provider.request({
          method: "eth_sendTransaction",
          params: [
            {
              from: account,
              to: action.callData ? action.toAddress : action.tokenAddress,
              data,
              value: "0x0",
            },
          ],
        });
        if (
          typeof submitted !== "string" ||
          !/^0x[0-9a-fA-F]{64}$/.test(submitted)
        ) {
          throw new Error("The wallet returned an invalid transaction hash");
        }
        hashes.push(submitted as Hex);
      }
      return hashes;
    },
    [account, active],
  );

  const disconnect = useCallback(() => {
    clearIdentity();
    setActive(undefined);
    setAccount(undefined);
    setError(undefined);
  }, [clearIdentity]);

  return {
    wallets,
    account,
    walletName: active?.name,
    connecting,
    derivingPrivacy,
    privacyAccount,
    error,
    connect,
    derivePrivacyIdentity,
    derivePrivacyRoute,
    openOperationJournal,
    submitDepositActions,
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
