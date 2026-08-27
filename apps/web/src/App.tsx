import { ArrowLeftIcon as ArrowLeft } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { ArrowRightIcon as ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CaretDownIcon as CaretDown } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon as Check } from "@phosphor-icons/react/dist/csr/Check";
import { CheckCircleIcon as CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { GlobeSimpleIcon as GlobeSimple } from "@phosphor-icons/react/dist/csr/GlobeSimple";
import { ImageSquareIcon as ImageSquare } from "@phosphor-icons/react/dist/csr/ImageSquare";
import { LockKeyIcon as LockKey } from "@phosphor-icons/react/dist/csr/LockKey";
import { MoonIcon as Moon } from "@phosphor-icons/react/dist/csr/Moon";
import { RocketLaunchIcon as RocketLaunch } from "@phosphor-icons/react/dist/csr/RocketLaunch";
import { ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { SparkleIcon as Sparkle } from "@phosphor-icons/react/dist/csr/Sparkle";
import { SunIcon as Sun } from "@phosphor-icons/react/dist/csr/Sun";
import { WarningIcon as Warning } from "@phosphor-icons/react/dist/csr/Warning";
import { WalletIcon as Wallet } from "@phosphor-icons/react/dist/csr/Wallet";
import { XIcon as X } from "@phosphor-icons/react/dist/csr/X";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import { bytesToHex } from "viem";
import type {
  PonsV2LaunchIntent,
  RelayExecutionRequest,
} from "@pons-privacy/sdk";
import type {
  LaunchApi,
  LaunchAccount,
  LaunchDraft,
  LaunchPreview,
  LaunchSubmission,
} from "./launch-api.js";
import { DepositDialog } from "./DepositDialog.js";
import { TradeDialog } from "./TradeDialog.js";
import type { DepositQuoteApi } from "./deposit-api.js";
import { useEvmWallet } from "./evm-wallet.js";
import type { PrivacyExecutionRunner } from "./privacy-execution.js";
import type { TradeApi } from "./trade-api.js";

interface AppProps {
  api: LaunchApi;
  depositApi: DepositQuoteApi;
  tradeApi: TradeApi;
  apiMode: "demo" | "live";
  launchEnabled: boolean;
  tradeEnabled?: boolean;
  mainnetPrivacyExecutionEnabled?: boolean;
  privacyExecutionRunner?: PrivacyExecutionRunner | undefined;
  ozAccountClassHash?: string | undefined;
}

type DraftErrors = Partial<
  Record<"name" | "symbol" | "logo" | "description", string>
>;
type Theme = "light" | "dark";
type PreparedLaunchAccount = LaunchAccount & { readonly rootWallet: string };

const emptyDraft: LaunchDraft = {
  name: "",
  symbol: "",
  logo: "",
  description: "",
  socials: {
    twitter: "",
    telegram: "",
    discord: "",
    website: "",
    farcaster: "",
  },
  creatorTaxBps: 0,
  buybackEnabled: false,
  launchConfigId: 0,
};

const encoder = new TextEncoder();

export function App({
  api,
  depositApi,
  tradeApi,
  apiMode,
  launchEnabled,
  tradeEnabled = false,
  mainnetPrivacyExecutionEnabled = false,
  privacyExecutionRunner,
  ozAccountClassHash,
}: AppProps) {
  const [draft, setDraft] = useState<LaunchDraft>(emptyDraft);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [preview, setPreview] = useState<LaunchPreview>();
  const [submission, setSubmission] = useState<LaunchSubmission>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<"preview" | "submit">();
  const [error, setError] = useState<string>();
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [depositOpen, setDepositOpen] = useState(false);
  const [tradeOpen, setTradeOpen] = useState(false);
  const [walletPickerOpen, setWalletPickerOpen] = useState(false);
  const [preparedLaunchAccount, setPreparedLaunchAccount] =
    useState<PreparedLaunchAccount>();
  const launchRequestRef = useRef<
    | { readonly previewId: string; readonly request: RelayExecutionRequest }
    | undefined
  >(undefined);
  const wallet = useEvmWallet();

  const errors = useMemo(() => validateDraft(draft), [draft]);
  const valid = Object.keys(errors).length === 0;
  const symbol = draft.symbol.trim().toUpperCase();
  const monogram = symbol.slice(0, 2) || "P?";

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    globalThis.localStorage?.setItem("pons-privacy-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (
      preparedLaunchAccount &&
      preparedLaunchAccount.rootWallet.toLowerCase() !==
        wallet.account?.toLowerCase()
    ) {
      setPreparedLaunchAccount(undefined);
      launchRequestRef.current = undefined;
    }
  }, [preparedLaunchAccount, wallet.account]);

  function update<K extends keyof LaunchDraft>(
    field: K,
    value: LaunchDraft[K],
  ) {
    setDraft((current) => ({ ...current, [field]: value }));
    setError(undefined);
  }

  function updateSocial(field: keyof LaunchDraft["socials"], value: string) {
    setDraft((current) => ({
      ...current,
      socials: { ...current.socials, [field]: value },
    }));
    setError(undefined);
  }

  async function review(event: FormEvent) {
    event.preventDefault();
    if (!valid || busy) return;
    setBusy("preview");
    setError(undefined);
    try {
      if (apiMode === "live" && !preparedLaunchAccount) {
        throw new Error(
          "Fund a fresh R2 account before reviewing a live launch",
        );
      }
      const result = await api.preview(
        {
          ...draft,
          name: draft.name.trim(),
          symbol,
        },
        preparedLaunchAccount
          ? publicLaunchAccount(preparedLaunchAccount)
          : undefined,
      );
      if (
        preparedLaunchAccount &&
        result.privacyAccount.toLowerCase() !==
          preparedLaunchAccount.account.toLowerCase()
      ) {
        throw new Error("Launch preview returned a different R2 account");
      }
      setPreview(result);
      launchRequestRef.current = undefined;
      setAcknowledged(false);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function submit() {
    if (
      !preview ||
      !acknowledged ||
      !launchEnabled ||
      !preparedLaunchAccount ||
      !ozAccountClassHash ||
      busy
    )
      return;
    setBusy("submit");
    setError(undefined);
    try {
      const normalizedDraft = { ...draft, name: draft.name.trim(), symbol };
      let signed = launchRequestRef.current;
      if (!signed || signed.previewId !== preview.previewId) {
        const saltBytes = crypto.getRandomValues(new Uint8Array(32));
        if (saltBytes.every((byte) => byte === 0)) saltBytes[31] = 1;
        signed = {
          previewId: preview.previewId,
          request: await wallet.prepareLaunchRequest(
            preparedLaunchAccount.accountIndex,
            ozAccountClassHash,
            draftToIntent(normalizedDraft, bytesToHex(saltBytes)),
          ),
        };
        if (
          signed.request.account.toLowerCase() !==
          preparedLaunchAccount.account.toLowerCase()
        ) {
          throw new Error(
            "Signed launch request returned a different R2 account",
          );
        }
        launchRequestRef.current = signed;
      }
      const result = await api.submit(
        normalizedDraft,
        preview.previewId,
        signed.request,
      );
      setSubmission(result);
      setPreview(undefined);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(undefined);
    }
  }

  function closeReview() {
    if (busy === "submit") return;
    setPreview(undefined);
    setAcknowledged(false);
    launchRequestRef.current = undefined;
  }

  function reset() {
    setDraft(emptyDraft);
    setSubmission(undefined);
    setPreview(undefined);
    setAcknowledged(false);
    setError(undefined);
  }

  function requestWalletConnection() {
    wallet.clearError();
    if (wallet.wallets.length > 1) {
      setWalletPickerOpen(true);
      return;
    }
    void wallet.connect();
  }

  return (
    <div className="site-shell">
      <header className="nav">
        <div className="nav-inner">
          <a className="nav-brand" href="#top" aria-label="Pons Privacy home">
            <span className="brand-orbit">
              <span>p</span>
              <i aria-hidden="true" />
            </span>
            <span className="brand-name">
              pons <em>privacy</em>
            </span>
          </a>

          <div className="nav-actions">
            <a
              className="nav-link"
              href="https://www.ponsfamily.com/launchpad"
              target="_blank"
              rel="noreferrer"
            >
              Explore
            </a>
            <button
              className="theme-button"
              type="button"
              aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`}
              onClick={() =>
                setTheme((current) => (current === "light" ? "dark" : "light"))
              }
            >
              {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
            </button>
            <button
              className="wallet-button"
              type="button"
              data-connected={Boolean(wallet.account)}
              onClick={
                wallet.account
                  ? () => setDepositOpen(true)
                  : requestWalletConnection
              }
            >
              <Wallet size={16} weight="fill" />
              <span>
                {wallet.account ? shorten(wallet.account) : "Connect wallet"}
              </span>
            </button>
          </div>
        </div>
      </header>

      <main className="launch-main" id="top">
        <div className="create-topbar">
          <a
            className="back-link"
            href="https://www.ponsfamily.com/launchpad"
            target="_blank"
            rel="noreferrer"
          >
            <ArrowLeft size={16} />
            <span>Back to Explore</span>
          </a>
          <div className="route-pills" aria-label="Launch configuration">
            <span className="version-pill">v2</span>
            <span className="private-pill">
              <LockKey size={12} weight="fill" /> private route
            </span>
          </div>
        </div>

        <section
          className="private-balance-strip"
          data-mode={apiMode}
          aria-label="Private balance"
        >
          <div className="balance-identity">
            <span className="balance-shield">
              <ShieldCheck size={21} weight="fill" />
            </span>
            <p>
              <small>STRK20 private balance</small>
              <strong>
                {preparedLaunchAccount
                  ? `Launcher ready · ${shorten(preparedLaunchAccount.account)}`
                  : wallet.account
                    ? "Not yet funded"
                    : "Connect to get started"}
              </strong>
            </p>
          </div>
          <div className="balance-route">
            <span>USDG</span>
            <i /> <em>LayerSwap</em> <i /> <span>private USDC</span>
          </div>
          <div className="balance-actions">
            <button
              className="deposit-button trade-button"
              type="button"
              onClick={() => setTradeOpen(true)}
            >
              Trade privately
              <ArrowRight size={15} weight="bold" />
            </button>
            <button
              className="deposit-button"
              type="button"
              onClick={() => setDepositOpen(true)}
            >
              Deposit
              <ArrowRight size={15} weight="bold" />
            </button>
          </div>
        </section>

        <div className="create-shell">
          <section className="form-panel">
            <header className="form-header">
              <div>
                <p className="overline">Pons Privacy</p>
                <h1>Launch token</h1>
              </div>
              <span className="network-badge">
                <i aria-hidden="true" /> Robinhood
              </span>
            </header>

            <form className="launch-form" onSubmit={review} noValidate>
              {error ? (
                <div className="error-banner" role="alert">
                  <Warning size={17} weight="fill" />
                  <span>{error}</span>
                  <button
                    type="button"
                    onClick={() => setError(undefined)}
                    aria-label="Dismiss error"
                  >
                    <X size={14} />
                  </button>
                </div>
              ) : null}

              <div className="field-grid">
                <Field
                  id="name"
                  label="Name"
                  note={`${encoder.encode(draft.name).length}/64 bytes`}
                  error={errors.name}
                >
                  <input
                    id="name"
                    name="name"
                    aria-label="Token name"
                    value={draft.name}
                    onChange={(event) => update("name", event.target.value)}
                    placeholder="Token name"
                    autoComplete="off"
                    maxLength={64}
                  />
                </Field>
                <Field
                  id="symbol"
                  label="Ticker"
                  note={`${encoder.encode(symbol).length}/16 bytes`}
                  error={errors.symbol}
                >
                  <input
                    id="symbol"
                    name="symbol"
                    aria-label="Ticker"
                    value={draft.symbol}
                    onChange={(event) =>
                      update("symbol", event.target.value.toUpperCase())
                    }
                    placeholder="SYMBOL"
                    autoComplete="off"
                    maxLength={16}
                  />
                </Field>

                <Field
                  id="description"
                  label="Description"
                  note={`${encoder.encode(draft.description).length}/2048 bytes`}
                  error={errors.description}
                  wide
                >
                  <textarea
                    id="description"
                    name="description"
                    value={draft.description}
                    onChange={(event) =>
                      update("description", event.target.value)
                    }
                    placeholder="A short description of the token"
                    rows={3}
                    maxLength={2_048}
                  />
                </Field>

                <Field
                  id="logo"
                  label="Token image"
                  note="IPFS or HTTPS · validated by the backend"
                  error={errors.logo}
                  wide
                >
                  <div className="artwork-field">
                    <span className="artwork-thumb">
                      <ImageSquare size={19} />
                    </span>
                    <input
                      id="logo"
                      name="logo"
                      type="url"
                      value={draft.logo}
                      onChange={(event) => update("logo", event.target.value)}
                      placeholder="Paste an image URL"
                      maxLength={512}
                    />
                    {draft.logo ? (
                      <span className="linked-state">linked</span>
                    ) : null}
                  </div>
                </Field>

                <div className="field wide">
                  <span className="field-label">Paired asset</span>
                  <div className="locked-select">
                    <span className="asset-mark">$</span>
                    <span>
                      <strong>USDG</strong>
                      <small>Pons-approved pair</small>
                    </span>
                    <LockKey size={14} />
                  </div>
                </div>
              </div>

              <div className="advanced-section">
                <button
                  type="button"
                  className="advanced-toggle"
                  aria-expanded={advancedOpen}
                  onClick={() => setAdvancedOpen((open) => !open)}
                >
                  <span>
                    <strong>Advanced</strong>
                    <small>Creator economics and social links</small>
                  </span>
                  <CaretDown size={15} data-open={advancedOpen} />
                </button>

                {advancedOpen ? (
                  <div className="advanced-panel">
                    <div className="tax-field">
                      <div className="tax-heading">
                        <span>
                          <strong>Creator tax</strong>
                          <small>
                            Maximum permitted by live Pons config: 10%
                          </small>
                        </span>
                        <b>{(draft.creatorTaxBps / 100).toFixed(2)}%</b>
                      </div>
                      <input
                        aria-label="Creator tax percentage"
                        type="range"
                        min="0"
                        max="10"
                        step="0.25"
                        value={draft.creatorTaxBps / 100}
                        style={
                          {
                            "--tax-progress": `${draft.creatorTaxBps / 10}%`,
                          } as CSSProperties
                        }
                        onChange={(event) =>
                          update(
                            "creatorTaxBps",
                            Math.round(Number(event.target.value) * 100),
                          )
                        }
                      />
                    </div>

                    <button
                      type="button"
                      className="buyback-switch"
                      role="switch"
                      aria-checked={draft.buybackEnabled}
                      onClick={() =>
                        update("buybackEnabled", !draft.buybackEnabled)
                      }
                    >
                      <span
                        className="switch-knob"
                        data-on={draft.buybackEnabled}
                      >
                        <i />
                      </span>
                      <span>
                        <strong>Buyback vault</strong>
                        <small>
                          Route the configured share toward protocol buybacks.
                        </small>
                      </span>
                    </button>

                    <div className="social-heading">
                      <GlobeSimple size={15} />
                      <span>Social links</span>
                    </div>
                    <div className="social-grid">
                      {(
                        [
                          ["website", "Website"],
                          ["twitter", "X / Twitter"],
                          ["telegram", "Telegram"],
                          ["discord", "Discord"],
                          ["farcaster", "Farcaster"],
                        ] as const
                      ).map(([field, label]) => (
                        <label key={field}>
                          <span>{label}</span>
                          <input
                            aria-label={label}
                            value={draft.socials[field]}
                            onChange={(event) =>
                              updateSocial(field, event.target.value)
                            }
                            placeholder="https://…"
                            maxLength={256}
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="privacy-disclosure">
                <ShieldCheck size={19} weight="fill" />
                <p>
                  <strong>One EVM wallet.</strong> Confirm the USDG deposit
                  once; Starknet shielding, proving, and the fresh Robinhood
                  launch account are handled behind the scenes.
                </p>
              </div>

              <footer className="form-actions">
                <div className="fee-copy">
                  <span>USDG pair · 0.0005 ETH due</span>
                  <small>
                    <Sparkle size={12} weight="fill" /> sponsored by relayer
                  </small>
                </div>
                <button
                  className="primary-button"
                  type="submit"
                  disabled={
                    !valid ||
                    Boolean(busy) ||
                    (apiMode === "live" && !preparedLaunchAccount)
                  }
                >
                  {busy === "preview"
                    ? "Checking live Pons state…"
                    : apiMode === "live" && !preparedLaunchAccount
                      ? "Fund launcher first"
                      : "Review launch"}
                  {busy !== "preview" ? (
                    <ArrowRight size={17} weight="bold" />
                  ) : null}
                </button>
              </footer>
            </form>
          </section>

          <aside
            className="preview-panel"
            aria-label="Token and privacy route preview"
          >
            <div className="token-preview-card">
              <div className="preview-top">
                <div className="preview-art" data-linked={Boolean(draft.logo)}>
                  <span>{monogram}</span>
                </div>
                <span className="preview-shield">
                  <ShieldCheck size={14} weight="fill" /> protected
                </span>
              </div>
              <div className="preview-identity">
                <h2>{draft.name.trim() || "Your token"}</h2>
                <p>{symbol || "ticker"}</p>
              </div>
              <p className="preview-description">
                {draft.description.trim() ||
                  "Your token description will appear here."}
              </p>
              <dl className="preview-details">
                <DetailRow label="Launch fee" value="0.0005 ETH" />
                <DetailRow label="Paired with" value="USDG" />
                <DetailRow
                  label="Creator tax"
                  value={`${(draft.creatorTaxBps / 100).toFixed(2)}%`}
                />
                <DetailRow label="Liquidity" value="Pons-managed" />
                <DetailRow
                  label="Starknet wallet"
                  value="Not required"
                  accent
                />
              </dl>
            </div>

            <div className="route-card">
              <header>
                <span>Private launch route</span>
                <i aria-hidden="true" />
              </header>
              <ol>
                <RouteStep index="1" title="LayerSwap → STRK20" active />
                <RouteStep
                  index="2"
                  title="Fresh Robinhood account"
                  active={Boolean(preview || submission)}
                />
                <RouteStep
                  index="3"
                  title="Pons V2"
                  active={Boolean(submission)}
                />
              </ol>
              <p>
                Root-wallet unlinkability only. Metadata, execution account,
                amounts, prices, timing, and transactions remain public.
              </p>
            </div>
          </aside>
        </div>

        <section
          className="privacy-boundary"
          id="privacy"
          aria-label="Privacy boundary"
        >
          <div>
            <span>Sanitized from Pons</span>
            <strong>Your root wallet identity</strong>
          </div>
          <div>
            <span>Always public</span>
            <strong>Token, account, amounts and timing</strong>
          </div>
          <div>
            <span>Held in browser memory</span>
            <strong>O2 signer and STRK20 viewing key</strong>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <a className="footer-brand" href="#top">
          pons privacy
        </a>
        <p>Root-wallet unlinkability—not confidential Robinhood execution.</p>
        <a
          href="https://docs.ponsfamily.com/v2"
          target="_blank"
          rel="noreferrer"
        >
          Pons docs <ArrowRight size={12} />
        </a>
      </footer>

      {preview ? (
        <ReviewDialog
          draft={{ ...draft, symbol }}
          preview={preview}
          acknowledged={acknowledged}
          launchEnabled={
            launchEnabled &&
            Boolean(preparedLaunchAccount) &&
            Boolean(ozAccountClassHash)
          }
          busy={busy === "submit"}
          onAcknowledge={setAcknowledged}
          onClose={closeReview}
          onSubmit={submit}
        />
      ) : null}

      {depositOpen ? (
        <DepositDialog
          api={depositApi}
          account={wallet.account}
          walletName={wallet.walletName}
          privacyAccount={wallet.privacyAccount}
          privacyConfigured={Boolean(ozAccountClassHash)}
          mainnetExecutionEnabled={mainnetPrivacyExecutionEnabled}
          derivingPrivacy={wallet.derivingPrivacy}
          onConnect={requestWalletConnection}
          onCreatePrivacy={async () => {
            if (!ozAccountClassHash) {
              throw new Error("The Starknet account class is not configured");
            }
            return wallet.derivePrivacyIdentity(ozAccountClassHash);
          }}
          onPrepareRoute={async (accountIndex) => {
            if (!ozAccountClassHash) {
              throw new Error("The Starknet account class is not configured");
            }
            return wallet.derivePrivacyRoute(accountIndex, ozAccountClassHash);
          }}
          onOpenJournal={async () => {
            if (!ozAccountClassHash) {
              throw new Error("The Starknet account class is not configured");
            }
            return wallet.openOperationJournal(ozAccountClassHash);
          }}
          onSubmitDepositActions={wallet.submitDepositActions}
          {...(privacyExecutionRunner
            ? {
                onQuotePrivateFee: privacyExecutionRunner.quotePrivateFee,
                onShieldDeposit: privacyExecutionRunner.shieldDeposit,
                onWithdrawToTransport:
                  privacyExecutionRunner.withdrawToTransport,
                onSubmitFundingAction:
                  privacyExecutionRunner.submitFundingAction,
              }
            : {})}
          onReadyForLaunch={(account) => {
            if (!wallet.account) return;
            setPreparedLaunchAccount({
              ...account,
              rootWallet: wallet.account,
            });
            launchRequestRef.current = undefined;
          }}
          onClose={() => setDepositOpen(false)}
        />
      ) : null}

      {tradeOpen ? (
        <TradeDialog
          api={tradeApi}
          depositApi={depositApi}
          account={wallet.account}
          privacyConfigured={Boolean(ozAccountClassHash)}
          mainnetExecutionEnabled={mainnetPrivacyExecutionEnabled}
          tradeSubmissionEnabled={tradeEnabled}
          onConnect={requestWalletConnection}
          onPrepareRoute={async (accountIndex) => {
            if (!ozAccountClassHash) {
              throw new Error("The Starknet account class is not configured");
            }
            return wallet.derivePrivacyRoute(accountIndex, ozAccountClassHash);
          }}
          onOpenJournal={async () => {
            if (!ozAccountClassHash) {
              throw new Error("The Starknet account class is not configured");
            }
            return wallet.openOperationJournal(ozAccountClassHash);
          }}
          onQuotePrivateFee={async () => {
            if (!privacyExecutionRunner) {
              throw new Error("STRK20 private execution is not configured");
            }
            return privacyExecutionRunner.quotePrivateFee();
          }}
          onWithdrawToTransport={async (route, amount, recovery) => {
            if (!privacyExecutionRunner) {
              throw new Error("STRK20 private execution is not configured");
            }
            return privacyExecutionRunner.withdrawToTransport(
              route,
              amount,
              recovery,
            );
          }}
          onSubmitFundingAction={async (route, action, recovery) => {
            if (!privacyExecutionRunner) {
              throw new Error("Starknet transport execution is not configured");
            }
            return privacyExecutionRunner.submitFundingAction(
              route,
              action,
              recovery,
            );
          }}
          onPrepareTradeRequest={async (accountIndex, intent) => {
            if (!ozAccountClassHash) {
              throw new Error("The Starknet account class is not configured");
            }
            return wallet.prepareTradeRequest(
              accountIndex,
              ozAccountClassHash,
              intent,
            );
          }}
          onPrepareReturnRequest={async (accountIndex, swapId, actions) => {
            if (!ozAccountClassHash) {
              throw new Error("The Starknet account class is not configured");
            }
            return wallet.prepareReturnRequest(
              accountIndex,
              ozAccountClassHash,
              swapId,
              actions,
            );
          }}
          onShieldReturn={async (route, request) => {
            if (!privacyExecutionRunner) {
              throw new Error("STRK20 private execution is not configured");
            }
            return privacyExecutionRunner.shieldReturn(route, request);
          }}
          onClose={() => setTradeOpen(false)}
        />
      ) : null}

      {walletPickerOpen ? (
        <WalletPicker
          wallets={wallet.wallets}
          connecting={wallet.connecting}
          onChoose={(id) => {
            setWalletPickerOpen(false);
            void wallet.connect(id);
          }}
          onClose={() => setWalletPickerOpen(false)}
        />
      ) : null}

      {wallet.error ? (
        <div className="wallet-toast" role="alert">
          <Warning size={16} weight="fill" />
          <span>{wallet.error}</span>
          <button
            type="button"
            onClick={wallet.clearError}
            aria-label="Dismiss wallet error"
          >
            <X size={14} />
          </button>
        </div>
      ) : null}

      {submission ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="success-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="success-title"
          >
            <span className="success-icon">
              <CheckCircle size={36} weight="fill" />
            </span>
            <p className="dialog-overline">Request accepted</p>
            <h2 id="success-title">The launch entered the protected queue.</h2>
            <p>
              Request <code>{submission.requestId}</code> is bound to execution
              account <code>{shorten(submission.privacyAccount)}</code>.
            </p>
            <button className="primary-button" type="button" onClick={reset}>
              Create another draft <ArrowRight size={16} />
            </button>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function WalletPicker({
  wallets,
  connecting,
  onChoose,
  onClose,
}: {
  wallets: readonly { id: string; name: string; icon?: string }[];
  connecting: boolean;
  onChoose(id: string): void;
  onClose(): void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="wallet-picker"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-title"
      >
        <header>
          <div>
            <p className="dialog-overline">EVM wallet</p>
            <h2 id="wallet-title">Connect to Robinhood Chain</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close wallet picker"
          >
            <X size={18} />
          </button>
        </header>
        <div className="wallet-options">
          {wallets.map((option) => (
            <button
              key={option.id}
              type="button"
              disabled={connecting}
              onClick={() => onChoose(option.id)}
            >
              {option.icon?.startsWith("data:") ? (
                <img src={option.icon} alt="" />
              ) : (
                <Wallet size={22} weight="fill" />
              )}
              <span>
                <strong>{option.name}</strong>
                <small>Robinhood Chain · 4663</small>
              </span>
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
        <p>No Ready, Xverse, or Starknet wallet is required.</p>
      </section>
    </div>
  );
}

function Field({
  id,
  label,
  note,
  error,
  wide = false,
  children,
}: {
  id: string;
  label: string;
  note: string;
  error?: string | undefined;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <label
      className={`field${wide ? " wide" : ""}`}
      htmlFor={id}
      data-invalid={Boolean(error)}
    >
      <span className="field-label">{label}</span>
      {children}
      <small className="field-note">{error ?? note}</small>
    </label>
  );
}

function RouteStep({
  index,
  title,
  active,
}: {
  index: string;
  title: string;
  active: boolean;
}) {
  return (
    <li data-active={active}>
      <span>{active ? <Check size={10} weight="bold" /> : index}</span>
      <strong>{title}</strong>
    </li>
  );
}

function DetailRow({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div data-accent={accent}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function ReviewDialog({
  draft,
  preview,
  acknowledged,
  launchEnabled,
  busy,
  onAcknowledge,
  onClose,
  onSubmit,
}: {
  draft: LaunchDraft;
  preview: LaunchPreview;
  acknowledged: boolean;
  launchEnabled: boolean;
  busy: boolean;
  onAcknowledge(value: boolean): void;
  onClose(): void;
  onSubmit(): void;
}) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="review-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="review-title"
      >
        <header>
          <div>
            <p className="dialog-overline">Final review</p>
            <h2 id="review-title">This becomes public and irreversible.</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close launch review"
          >
            <X size={18} />
          </button>
        </header>

        <div className="review-token">
          <span>{draft.symbol.slice(0, 2) || "P?"}</span>
          <div>
            <small>Token identity</small>
            <strong>{draft.name}</strong>
            <p>{draft.symbol}</p>
          </div>
        </div>

        <dl className="review-ledger">
          <DetailRow
            label="Network"
            value={`${preview.chainName} · ${preview.chainId}`}
          />
          <DetailRow label="Pair asset" value="USDG" />
          <DetailRow
            label="Launch fee"
            value={`${preview.launchFeeEth} ETH · sponsored`}
          />
          <DetailRow
            label="Creator tax"
            value={`${(draft.creatorTaxBps / 100).toFixed(2)}%`}
          />
          <DetailRow
            label="Buyback vault"
            value={draft.buybackEnabled ? "Enabled" : "Disabled"}
          />
          <DetailRow
            label="Execution account"
            value={shorten(preview.privacyAccount, 8, 6)}
            accent
          />
        </dl>

        <div className="review-disclosures">
          <div className="disclosure protected">
            <ShieldCheck size={18} weight="fill" />
            <p>
              <strong>Sanitized:</strong> your root wallet does not appear as
              the Pons deployer, caller, or fee recipient.
            </p>
          </div>
          <div className="disclosure public">
            <Warning size={18} weight="fill" />
            <p>
              <strong>Public:</strong> metadata, execution account, transaction,
              amounts, and timing remain observable.
            </p>
          </div>
        </div>

        <label className="acknowledgement">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => onAcknowledge(event.target.checked)}
          />
          <span>
            I reviewed the token identity, economics, and public privacy
            boundary.
          </span>
        </label>

        <div className="review-action">
          <p>
            {launchEnabled
              ? "The backend will re-read live Pons state and simulate before broadcast."
              : "Mainnet submission is intentionally disabled in this frontend-first build."}
          </p>
          <button
            className="primary-button"
            type="button"
            disabled={!acknowledged || !launchEnabled || busy}
            onClick={onSubmit}
          >
            {busy
              ? "Submitting protected launch…"
              : launchEnabled
                ? "Confirm protected launch"
                : "Mainnet launch locked"}
            {!busy ? <RocketLaunch size={17} weight="fill" /> : null}
          </button>
        </div>
      </section>
    </div>
  );
}

function initialTheme(): Theme {
  if (typeof window === "undefined") return "light";
  const stored = window.localStorage.getItem("pons-privacy-theme");
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function validateDraft(draft: LaunchDraft): DraftErrors {
  const errors: DraftErrors = {};
  const nameBytes = encoder.encode(draft.name.trim()).length;
  const symbolBytes = encoder.encode(draft.symbol.trim()).length;
  if (nameBytes < 1 || nameBytes > 64)
    errors.name = "Required · 64 UTF-8 bytes maximum";
  if (symbolBytes < 1 || symbolBytes > 16)
    errors.symbol = "Required · 16 UTF-8 bytes maximum";
  if (encoder.encode(draft.logo).length > 512)
    errors.logo = "512 UTF-8 bytes maximum";
  if (encoder.encode(draft.description).length > 2_048)
    errors.description = "2048 UTF-8 bytes maximum";
  return errors;
}

function publicLaunchAccount(account: PreparedLaunchAccount): LaunchAccount {
  return {
    account: account.account,
    owner: account.owner,
    accountIndex: account.accountIndex,
  };
}

function draftToIntent(
  draft: LaunchDraft,
  salt: `0x${string}`,
): PonsV2LaunchIntent {
  return {
    name: draft.name,
    symbol: draft.symbol,
    logo: draft.logo,
    description: draft.description,
    socials: { ...draft.socials },
    creatorTaxBps: draft.creatorTaxBps,
    buybackEnabled: draft.buybackEnabled,
    launchConfigId: BigInt(draft.launchConfigId),
    salt,
  };
}

function shorten(value: string, head = 6, tail = 4): string {
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function message(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : "The launch service could not prepare this request";
}
