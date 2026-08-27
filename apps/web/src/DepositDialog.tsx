import { ArrowRightIcon as ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowsDownUpIcon as ArrowsDownUp } from "@phosphor-icons/react/dist/csr/ArrowsDownUp";
import { CheckCircleIcon as CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { LockKeyIcon as LockKey } from "@phosphor-icons/react/dist/csr/LockKey";
import { ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { WalletIcon as Wallet } from "@phosphor-icons/react/dist/csr/Wallet";
import { WarningIcon as Warning } from "@phosphor-icons/react/dist/csr/Warning";
import { XIcon as X } from "@phosphor-icons/react/dist/csr/X";
import { useState, type FormEvent } from "react";
import type { LayerswapQuote } from "@pons-privacy/sdk";
import {
  formatUsdAmount,
  parseUsdAmount,
  type DepositQuoteApi,
} from "./deposit-api.js";

export function DepositDialog({
  api,
  account,
  walletName,
  privacyAccount,
  privacyConfigured,
  derivingPrivacy,
  onConnect,
  onCreatePrivacy,
  onClose,
}: {
  api: DepositQuoteApi;
  account: string | undefined;
  walletName: string | undefined;
  privacyAccount: string | undefined;
  privacyConfigured: boolean;
  derivingPrivacy: boolean;
  onConnect(): void;
  onCreatePrivacy(): Promise<void>;
  onClose(): void;
}) {
  const [amount, setAmount] = useState("10");
  const [quote, setQuote] = useState<LayerswapQuote>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function review(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setQuote(undefined);
    try {
      setQuote(await api.quote(parseUsdAmount(amount)));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not quote this deposit",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="deposit-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deposit-title"
      >
        <header className="deposit-header">
          <div className="deposit-title-mark">
            <ShieldCheck size={21} weight="fill" />
          </div>
          <div>
            <p className="dialog-overline">Private balance</p>
            <h2 id="deposit-title">
              Deposit without bringing your wallet to Pons.
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close deposit">
            <X size={18} />
          </button>
        </header>

        <div className="deposit-wallet-row" data-connected={Boolean(account)}>
          <Wallet size={18} weight="fill" />
          <span>
            <small>
              {account ? (walletName ?? "Connected wallet") : "Source wallet"}
            </small>
            <strong>
              {account ? shorten(account) : "Connect an EVM wallet"}
            </strong>
          </span>
          {account ? <CheckCircle size={18} weight="fill" /> : null}
        </div>

        {privacyAccount ? (
          <div className="deposit-wallet-row" data-connected>
            <ShieldCheck size={18} weight="fill" />
            <span>
              <small>Your private Starknet account</small>
              <strong>{shorten(privacyAccount)}</strong>
            </span>
            <CheckCircle size={18} weight="fill" />
          </div>
        ) : null}

        <form className="deposit-form" onSubmit={review}>
          <label htmlFor="deposit-amount">Amount to make private</label>
          <div className="deposit-amount-field">
            <input
              id="deposit-amount"
              aria-label="Deposit amount"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setQuote(undefined);
                setError(undefined);
              }}
              autoComplete="off"
            />
            <span>
              <i>$</i> USDG
            </span>
          </div>
          <div className="amount-presets" aria-label="Deposit amount presets">
            {["10", "25", "100"].map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmount(preset)}
              >
                ${preset}
              </button>
            ))}
          </div>

          <div className="deposit-route" aria-label="Deposit route">
            <div>
              <span className="route-network-mark robinhood-mark">R</span>
              <p>
                <strong>USDG</strong>
                <small>Robinhood</small>
              </p>
            </div>
            <span className="route-bridge-mark">
              <ArrowsDownUp size={15} />
              <small>LayerSwap</small>
            </span>
            <div>
              <span className="route-network-mark starknet-mark">S</span>
              <p>
                <strong>USDC</strong>
                <small>STRK20 private</small>
              </p>
            </div>
          </div>

          {error ? (
            <div className="deposit-error" role="alert">
              <Warning size={16} weight="fill" /> {error}
            </div>
          ) : null}

          {quote ? (
            <div className="deposit-quote" aria-label="LayerSwap quote">
              <div>
                <span>You deposit</span>
                <strong>{formatUsdAmount(quote.amountIn)} USDG</strong>
              </div>
              <div>
                <span>Expected private balance</span>
                <strong>
                  ≈ {formatUsdAmount(quote.expectedAmountOut)} USDC
                </strong>
              </div>
              <div>
                <span>Minimum received</span>
                <strong>{formatUsdAmount(quote.minAmountOut)} USDC</strong>
              </div>
              <div>
                <span>Route fees</span>
                <strong>{formatUsdAmount(quote.feeAmount)} USDG</strong>
              </div>
              <p>Live LayerSwap quote · refreshes before any transfer</p>
            </div>
          ) : null}

          {!account ? (
            <button
              className="primary-button deposit-primary"
              type="button"
              onClick={onConnect}
            >
              Connect wallet <Wallet size={17} weight="fill" />
            </button>
          ) : quote && !privacyAccount ? (
            privacyConfigured ? (
              <button
                className="primary-button deposit-primary"
                type="button"
                disabled={derivingPrivacy}
                onClick={() => void onCreatePrivacy()}
              >
                {derivingPrivacy
                  ? "Creating private account…"
                  : "Create my private account"}
                {!derivingPrivacy ? (
                  <ShieldCheck size={17} weight="fill" />
                ) : null}
              </button>
            ) : (
              <div className="deposit-gate">
                <LockKey size={17} weight="fill" />
                <p>
                  <strong>Privacy account setup required</strong>
                  The OpenZeppelin Starknet account class hash is not
                  configured.
                </p>
              </div>
            )
          ) : quote ? (
            <div className="deposit-gate">
              <LockKey size={17} weight="fill" />
              <p>
                <strong>Mainnet transfer locked</strong>
                The quote is live. Transfer unlocks after the minimum-value
                route test and deposit-action validation.
              </p>
            </div>
          ) : (
            <button
              className="primary-button deposit-primary"
              type="submit"
              disabled={busy}
            >
              {busy ? "Checking live route…" : "Review private deposit"}
              {!busy ? <ArrowRight size={17} weight="bold" /> : null}
            </button>
          )}
        </form>

        <p className="deposit-footnote">
          One wallet signature derives keys locally. No Ready/Xverse wallet is
          required, and the signature authorizes no transfer. Amount and timing
          remain public at the edges.
        </p>
      </section>
    </div>
  );
}

function shorten(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
