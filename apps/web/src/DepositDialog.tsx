import { ArrowRightIcon as ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { ArrowsDownUpIcon as ArrowsDownUp } from "@phosphor-icons/react/dist/csr/ArrowsDownUp";
import { CheckCircleIcon as CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon as ClockCounterClockwise } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { LockKeyIcon as LockKey } from "@phosphor-icons/react/dist/csr/LockKey";
import { ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { WalletIcon as Wallet } from "@phosphor-icons/react/dist/csr/Wallet";
import { WarningIcon as Warning } from "@phosphor-icons/react/dist/csr/Warning";
import { XIcon as X } from "@phosphor-icons/react/dist/csr/X";
import { useRef, useState, type FormEvent } from "react";
import type {
  DerivedPonsPrivacyIdentity,
  LayerswapDepositAction,
  LayerswapFundingAction,
  LayerswapQuote,
  PonsOperationJournal,
  PrivacyOperation,
  ResolvedPonsPrivacyRoute,
} from "@pons-privacy/sdk";
import {
  formatUsdAmount,
  parseUsdAmount,
  type DepositQuoteApi,
} from "./deposit-api.js";

type FlowMode = "deposit" | "exit";

export function DepositDialog({
  api,
  account,
  walletName,
  privacyAccount,
  privacyConfigured,
  mainnetExecutionEnabled,
  derivingPrivacy,
  onConnect,
  onCreatePrivacy,
  onPrepareRoute,
  onOpenJournal,
  onSubmitDepositActions,
  onWithdrawToTransport,
  onSubmitFundingAction,
  onReadyForLaunch,
  onClose,
}: {
  api: DepositQuoteApi;
  account: string | undefined;
  walletName: string | undefined;
  privacyAccount: string | undefined;
  privacyConfigured: boolean;
  mainnetExecutionEnabled: boolean;
  derivingPrivacy: boolean;
  onConnect(): void;
  onCreatePrivacy(): Promise<DerivedPonsPrivacyIdentity>;
  onPrepareRoute(accountIndex: number): Promise<ResolvedPonsPrivacyRoute>;
  onOpenJournal(): Promise<PonsOperationJournal>;
  onSubmitDepositActions(
    actions: readonly LayerswapDepositAction[],
  ): Promise<readonly string[]>;
  onWithdrawToTransport?(
    route: ResolvedPonsPrivacyRoute,
    amount: bigint,
  ): Promise<string>;
  onSubmitFundingAction?(
    route: ResolvedPonsPrivacyRoute,
    action: LayerswapFundingAction,
  ): Promise<string>;
  onReadyForLaunch?(address: string): void;
  onClose(): void;
}) {
  const [mode, setMode] = useState<FlowMode>("deposit");
  const [amount, setAmount] = useState("10");
  const [quote, setQuote] = useState<LayerswapQuote>();
  const [operation, setOperation] = useState<PrivacyOperation>();
  const [route, setRoute] = useState<ResolvedPonsPrivacyRoute>();
  const [operations, setOperations] = useState<readonly PrivacyOperation[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const journalRef = useRef<PonsOperationJournal | undefined>(undefined);

  const sourceAsset = mode === "deposit" ? "USDG" : "private USDC";
  const destinationAsset = mode === "deposit" ? "private USDC" : "USDG";

  function changeMode(next: FlowMode) {
    if (busy) return;
    setMode(next);
    setQuote(undefined);
    setOperation(undefined);
    setRoute(undefined);
    setError(undefined);
  }

  async function review(event: FormEvent) {
    event.preventDefault();
    setBusy("quote");
    setError(undefined);
    setQuote(undefined);
    setOperation(undefined);
    setRoute(undefined);
    try {
      const amountIn = parseUsdAmount(amount);
      const result =
        mode === "deposit"
          ? await api.quote(amountIn)
          : await requireMethod(
              api.quoteFunding,
              "Private exit quoting",
            )(amountIn);
      setQuote(result);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function unlockActivity() {
    setBusy("activity");
    setError(undefined);
    try {
      await onCreatePrivacy();
      const journal = await onOpenJournal();
      journalRef.current = journal;
      setOperations(await journal.list());
      setActivityOpen(true);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function prepare() {
    if (!quote) return;
    setBusy("prepare");
    setError(undefined);
    try {
      const accountIndex = freshAccountIndex();
      const nextRoute = await onPrepareRoute(accountIndex);
      const journal = journalRef.current ?? (await onOpenJournal());
      journalRef.current = journal;
      const created = await journal.create({
        direction: mode,
        accountIndex,
        amount: quote.amountIn,
        rootStarknetAddress: nextRoute.rootIdentity.starknetAddress,
        ...(mode === "exit"
          ? {
              transportStarknetAddress:
                nextRoute.transportIdentity.starknetAddress,
              robinhoodExecutionAddress: nextRoute.robinhoodExecutionAccount,
            }
          : {}),
        quoteExpiresAt: quote.expiresAt,
      });
      const ready = await journal.advance(created.id, "quote-ready", {
        quoteExpiresAt: quote.expiresAt,
      });
      setRoute(nextRoute);
      setOperation(ready);
      setOperations(await journal.list());
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function resume(candidate: PrivacyOperation) {
    setBusy("resume");
    setError(undefined);
    try {
      const nextRoute = await onPrepareRoute(candidate.accountIndex);
      if (
        BigInt(candidate.rootStarknetAddress) !==
          BigInt(nextRoute.rootIdentity.starknetAddress) ||
        (candidate.direction === "exit" &&
          (BigInt(candidate.transportStarknetAddress!) !==
            BigInt(nextRoute.transportIdentity.starknetAddress) ||
            candidate.robinhoodExecutionAddress?.toLowerCase() !==
              nextRoute.robinhoodExecutionAccount.toLowerCase()))
      ) {
        throw new Error(
          "Saved route no longer matches the pinned account derivation",
        );
      }
      setMode(candidate.direction);
      setAmount(formatUsdAmount(BigInt(candidate.amount), 6));
      setOperation(candidate);
      setRoute(nextRoute);
      if (candidate.state === "draft" || candidate.state === "quote-ready") {
        const amountIn = BigInt(candidate.amount);
        setQuote(
          candidate.direction === "deposit"
            ? await api.quote(amountIn)
            : await requireMethod(
                api.quoteFunding,
                "Private exit quoting",
              )(amountIn),
        );
      } else {
        setQuote(undefined);
      }
      setActivityOpen(false);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function executePreparedRoute() {
    if (!quote || !route || !operation || !journalRef.current || !account)
      return;
    const journal = journalRef.current;
    setBusy("execute");
    setError(undefined);
    try {
      if (!mainnetExecutionEnabled)
        throw new Error("Mainnet privacy execution is locked");
      if (mode === "deposit") {
        const create = requireMethod(
          api.createDepositSwap,
          "Deposit swap creation",
        );
        const prepared = await create({
          operationId: operation.id,
          amountIn: quote.amountIn,
          sourceAddress: account,
          destinationAddress: route.rootIdentity.starknetAddress,
        });
        let current = await journal.advance(operation.id, "swap-created", {
          swapId: prepared.swap.id,
        });
        setOperation(current);
        const hashes = await onSubmitDepositActions(prepared.depositActions);
        current = await journal.advance(operation.id, "source-submitted", {
          ...(hashes[0] ? { sourceTxHash: hashes[0] } : {}),
        });
        setOperation(current);
      } else {
        const withdraw = requireMethod(
          onWithdrawToTransport,
          "STRK20 private withdrawal",
        );
        const fund = requireMethod(
          onSubmitFundingAction,
          "S2 LayerSwap funding",
        );
        const create = requireMethod(
          api.createFundingSwap,
          "Funding swap creation",
        );
        const prepared = await create({
          operationId: operation.id,
          amountIn: quote.amountIn,
          sourceAddress: route.transportIdentity.starknetAddress,
          destinationAddress: route.robinhoodExecutionAccount,
        });
        let current = await journal.advance(operation.id, "swap-created", {
          swapId: prepared.swap.id,
        });
        setOperation(current);
        const privateTxHash = await withdraw(route, quote.amountIn);
        current = await journal.advance(
          operation.id,
          "private-withdrawal-submitted",
          { privateTxHash },
        );
        setOperation(current);
        const transportTxHash = await fund(route, prepared.depositAction);
        current = await journal.advance(operation.id, "transport-funded", {
          transportTxHash,
        });
        current = await journal.advance(
          operation.id,
          "bridge-transfer-submitted",
          { transportTxHash },
        );
        setOperation(current);
      }
      setOperations(await journal.list());
    } catch (cause) {
      const errorMessage = message(cause);
      if (operation) {
        try {
          setOperation(await journal.recordError(operation.id, errorMessage));
        } catch {
          // Preserve the actionable execution error if journal recovery also fails.
        }
      }
      setError(errorMessage);
    } finally {
      setBusy(undefined);
    }
  }

  async function continueOperation() {
    if (!route || !operation || !journalRef.current || !account) return;
    const journal = journalRef.current;
    const amountIn = BigInt(operation.amount);
    setBusy("continue");
    setError(undefined);
    try {
      if (!mainnetExecutionEnabled) {
        throw new Error("Mainnet privacy execution is locked");
      }
      let current = operation;
      if (
        operation.direction === "deposit" &&
        operation.state === "swap-created"
      ) {
        const actions = await requireMethod(
          api.getDepositActions,
          "Deposit action recovery",
        )(operation.swapId!, account, amountIn);
        const hashes = await onSubmitDepositActions(actions);
        current = await journal.advance(operation.id, "source-submitted", {
          ...(hashes[0] ? { sourceTxHash: hashes[0] } : {}),
        });
      } else if (
        operation.direction === "exit" &&
        (operation.state === "swap-created" ||
          operation.state === "private-withdrawal-submitted")
      ) {
        const action = await requireMethod(
          api.getFundingAction,
          "S2 funding-action recovery",
        )(operation.swapId!, route.transportIdentity.starknetAddress, amountIn);
        if (operation.state === "swap-created") {
          const privateTxHash = await requireMethod(
            onWithdrawToTransport,
            "STRK20 private withdrawal",
          )(route, amountIn);
          current = await journal.advance(
            operation.id,
            "private-withdrawal-submitted",
            { privateTxHash },
          );
          setOperation(current);
        }
        const transportTxHash = await requireMethod(
          onSubmitFundingAction,
          "S2 LayerSwap funding",
        )(route, action);
        current = await journal.advance(operation.id, "transport-funded", {
          transportTxHash,
        });
        current = await journal.advance(
          operation.id,
          "bridge-transfer-submitted",
          { transportTxHash },
        );
      } else if (
        operation.direction === "exit" &&
        operation.state === "transport-funded"
      ) {
        current = await journal.advance(
          operation.id,
          "bridge-transfer-submitted",
          operation.transportTxHash
            ? { transportTxHash: operation.transportTxHash }
            : {},
        );
      }
      setOperation(current);
      setOperations(await journal.list());
    } catch (cause) {
      const errorMessage = message(cause);
      try {
        setOperation(await journal.recordError(operation.id, errorMessage));
      } catch {
        // Keep the execution error visible even if journal recovery also fails.
      }
      setError(errorMessage);
    } finally {
      setBusy(undefined);
    }
  }

  async function refreshStatus() {
    if (!operation?.swapId || !journalRef.current || !account) return;
    setBusy("status");
    setError(undefined);
    try {
      const status =
        operation.direction === "deposit"
          ? await requireMethod(api.getDepositSwap, "Deposit status")(
              operation.swapId,
              account,
            )
          : await requireMethod(api.getFundingSwap, "Funding status")(
              operation.swapId,
              operation.transportStarknetAddress!,
            );
      let current = operation;
      if (status.status === "completed") {
        if (
          operation.direction === "deposit" &&
          operation.state === "source-submitted"
        ) {
          current = await journalRef.current.advance(
            operation.id,
            "bridged-to-starknet",
            {
              ...(status.outputTransactionHash
                ? { destinationTxHash: status.outputTransactionHash }
                : {}),
            },
          );
        } else if (
          operation.direction === "exit" &&
          operation.state === "bridge-transfer-submitted"
        ) {
          current = await journalRef.current.advance(
            operation.id,
            "ready-on-robinhood",
            {
              ...(status.outputTransactionHash
                ? { destinationTxHash: status.outputTransactionHash }
                : {}),
            },
          );
          onReadyForLaunch?.(route!.robinhoodExecutionAccount);
        }
      } else if (status.status === "pending_refund") {
        current = await journalRef.current.advance(operation.id, "refunding");
      } else if (status.status === "refunded") {
        if (operation.state !== "refunding") {
          current = await journalRef.current.advance(operation.id, "refunding");
        }
        current = await journalRef.current.advance(operation.id, "refunded");
      } else if (status.status === "failed" || status.status === "expired") {
        current = await journalRef.current.recordError(
          operation.id,
          status.failReason ?? `LayerSwap status: ${status.status}`,
        );
      }
      setOperation(current);
      setOperations(await journalRef.current.list());
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(undefined);
    }
  }

  const statusRefreshable = Boolean(
    operation?.swapId &&
    ["source-submitted", "bridge-transfer-submitted", "refunding"].includes(
      operation.state,
    ),
  );
  const continuationAvailable = Boolean(
    operation?.swapId &&
    [
      "swap-created",
      "private-withdrawal-submitted",
      "transport-funded",
    ].includes(operation.state),
  );
  const canStartExecution =
    mainnetExecutionEnabled &&
    mode === "exit" &&
    Boolean(onWithdrawToTransport && onSubmitFundingAction);

  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="deposit-dialog privacy-flow-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deposit-title"
      >
        <header className="deposit-header">
          <div className="deposit-title-mark">
            <ShieldCheck size={21} weight="fill" />
          </div>
          <div>
            <p className="dialog-overline">Pons Privacy rail</p>
            <h2 id="deposit-title">
              Move value without exposing the root wallet.
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close privacy rail"
          >
            <X size={18} />
          </button>
        </header>

        <div
          className="privacy-flow-tabs"
          role="tablist"
          aria-label="Privacy route"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "deposit"}
            onClick={() => changeMode("deposit")}
          >
            Make private
            <small>Robinhood → STRK20</small>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "exit"}
            onClick={() => changeMode("exit")}
          >
            Fund launcher
            <small>STRK20 → fresh Robinhood</small>
          </button>
        </div>

        <div className="deposit-wallet-row" data-connected={Boolean(account)}>
          <Wallet size={18} weight="fill" />
          <span>
            <small>
              {account
                ? (walletName ?? "Connected wallet")
                : "Controller wallet"}
            </small>
            <strong>
              {account ? shorten(account) : "Connect an EVM wallet"}
            </strong>
          </span>
          {account ? <CheckCircle size={18} weight="fill" /> : null}
        </div>

        {privacyAccount ? (
          <div className="privacy-session-row">
            <span>
              <ShieldCheck size={16} weight="fill" />
              S1 {shorten(privacyAccount)}
            </span>
            <button
              type="button"
              onClick={() => void unlockActivity()}
              disabled={Boolean(busy)}
            >
              <ClockCounterClockwise size={14} /> Activity
            </button>
          </div>
        ) : null}

        {activityOpen ? (
          <div
            className="privacy-activity"
            aria-label="Recoverable privacy operations"
          >
            <header>
              <strong>Encrypted activity</strong>
              <button
                type="button"
                onClick={() => setActivityOpen(false)}
                aria-label="Close activity"
              >
                <X size={13} />
              </button>
            </header>
            {operations.length ? (
              operations.slice(0, 5).map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  onClick={() => void resume(candidate)}
                >
                  <span>
                    {candidate.direction === "deposit"
                      ? "Make private"
                      : "Fund launcher"}
                  </span>
                  <strong>
                    {formatUsdAmount(BigInt(candidate.amount))} ·{" "}
                    {stateLabel(candidate.state)}
                  </strong>
                </button>
              ))
            ) : (
              <p>No recoverable operations for this wallet.</p>
            )}
          </div>
        ) : (
          <form className="deposit-form" onSubmit={review}>
            <label htmlFor="deposit-amount">
              {mode === "deposit"
                ? "USDG to make private"
                : "Private USDC to move to Pons"}
            </label>
            <div className="deposit-amount-field">
              <input
                id="deposit-amount"
                aria-label={
                  mode === "deposit" ? "Deposit amount" : "Private exit amount"
                }
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  setQuote(undefined);
                  setOperation(undefined);
                  setRoute(undefined);
                  setError(undefined);
                }}
                autoComplete="off"
              />
              <span>
                <i>$</i> {mode === "deposit" ? "USDG" : "USDC"}
              </span>
            </div>
            <div className="amount-presets" aria-label="Amount presets">
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

            <div className="deposit-route" aria-label="Privacy route">
              <div>
                <span
                  className={`route-network-mark ${mode === "deposit" ? "robinhood-mark" : "starknet-mark"}`}
                >
                  {mode === "deposit" ? "R" : "S"}
                </span>
                <p>
                  <strong>{sourceAsset}</strong>
                  <small>
                    {mode === "deposit" ? "your wallet" : "shielded balance"}
                  </small>
                </p>
              </div>
              <span className="route-bridge-mark">
                <ArrowsDownUp size={15} />
                <small>LayerSwap</small>
              </span>
              <div>
                <span
                  className={`route-network-mark ${mode === "deposit" ? "starknet-mark" : "robinhood-mark"}`}
                >
                  {mode === "deposit" ? "S" : "R"}
                </span>
                <p>
                  <strong>{destinationAsset}</strong>
                  <small>
                    {mode === "deposit" ? "S1 + STRK20" : "fresh R2"}
                  </small>
                </p>
              </div>
            </div>

            {route && mode === "exit" ? (
              <div className="fresh-route-proof">
                <span>
                  <small>Fresh bridge wallet · S2</small>
                  <code>
                    {shorten(route.transportIdentity.starknetAddress)}
                  </code>
                </span>
                <ArrowRight size={13} />
                <span>
                  <small>Fresh Pons controller · R2</small>
                  <code>{shorten(route.robinhoodExecutionAccount)}</code>
                </span>
              </div>
            ) : null}

            {error ? (
              <div className="deposit-error" role="alert">
                <Warning size={16} weight="fill" /> {error}
              </div>
            ) : null}

            {quote ? <QuoteCard quote={quote} mode={mode} /> : null}
            {operation ? <OperationTimeline operation={operation} /> : null}

            {!account ? (
              <button
                className="primary-button deposit-primary"
                type="button"
                onClick={onConnect}
              >
                Connect wallet <Wallet size={17} weight="fill" />
              </button>
            ) : !quote && !operation ? (
              <button
                className="primary-button deposit-primary"
                type="submit"
                disabled={Boolean(busy)}
              >
                {busy === "quote"
                  ? "Checking live route…"
                  : mode === "deposit"
                    ? "Review private deposit"
                    : "Review launcher funding"}
                {busy !== "quote" ? (
                  <ArrowRight size={17} weight="bold" />
                ) : null}
              </button>
            ) : quote && !operation ? (
              privacyConfigured ? (
                <button
                  className="primary-button deposit-primary"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void prepare()}
                >
                  {busy === "prepare" || derivingPrivacy
                    ? "Securing route…"
                    : "Secure and save this route"}
                  {!busy ? <ShieldCheck size={17} weight="fill" /> : null}
                </button>
              ) : (
                <Gate title="Privacy account setup required">
                  The verified Starknet account class is not configured.
                </Gate>
              )
            ) : operation?.state === "quote-ready" ? (
              canStartExecution ? (
                <button
                  className="primary-button deposit-primary"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void executePreparedRoute()}
                >
                  {busy === "execute"
                    ? "Executing protected route…"
                    : "Move private funds to launcher"}
                  {!busy ? <ArrowRight size={17} weight="bold" /> : null}
                </button>
              ) : (
                <Gate
                  title={
                    mode === "deposit"
                      ? "Deposit runner remains locked"
                      : "Mainnet movement locked"
                  }
                >
                  {mode === "deposit"
                    ? "The route and recovery record are ready. The STRK20 invoke-and-apply-action allowlist must be frozen before USDG can move."
                    : "The route and recovery record are ready. Value movement remains off for the minimum-value end-to-end test."}
                </Gate>
              )
            ) : continuationAvailable ? (
              mainnetExecutionEnabled ? (
                <button
                  className="primary-button deposit-primary"
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => void continueOperation()}
                >
                  {busy === "continue"
                    ? "Recovering protected route…"
                    : "Continue saved operation"}
                  {!busy ? <ArrowRight size={17} weight="bold" /> : null}
                </button>
              ) : (
                <Gate title="Saved operation ready to resume">
                  Re-sign with the controller wallet after the mainnet execution
                  gate is enabled; no private key was stored.
                </Gate>
              )
            ) : statusRefreshable ? (
              <button
                className="primary-button deposit-primary"
                type="button"
                disabled={Boolean(busy)}
                onClick={() => void refreshStatus()}
              >
                {busy === "status"
                  ? "Checking LayerSwap…"
                  : "Refresh bridge status"}
                {!busy ? <ClockCounterClockwise size={17} /> : null}
              </button>
            ) : operation?.state === "bridged-to-starknet" ? (
              <Gate title="STRK20 shield is the next atomic leg">
                The S1 balance has arrived. The deposit runner stays locked
                until its AVNU invoke-and-apply-action allowlist is frozen.
              </Gate>
            ) : operation?.state === "ready-on-robinhood" ? (
              <div className="privacy-ready">
                <CheckCircle size={20} weight="fill" />
                <p>
                  <strong>Fresh Robinhood account funded</strong>R2 can now
                  control a launch without exposing the root wallet.
                </p>
              </div>
            ) : null}
          </form>
        )}

        <p className="deposit-footnote">
          One wallet signature re-derives the same keys locally. The encrypted
          journal can resume a route without storing keys, proofs, or addresses
          in clear text. Amount and timing remain public at both edges.
        </p>
      </section>
    </div>
  );
}

function QuoteCard({ quote, mode }: { quote: LayerswapQuote; mode: FlowMode }) {
  return (
    <div className="deposit-quote" aria-label="LayerSwap quote">
      <div>
        <span>You send</span>
        <strong>
          {formatUsdAmount(quote.amountIn)}{" "}
          {mode === "deposit" ? "USDG" : "USDC"}
        </strong>
      </div>
      <div>
        <span>Expected at destination</span>
        <strong>
          ≈ {formatUsdAmount(quote.expectedAmountOut)}{" "}
          {mode === "deposit" ? "USDC" : "USDG"}
        </strong>
      </div>
      <div>
        <span>Minimum received</span>
        <strong>{formatUsdAmount(quote.minAmountOut)}</strong>
      </div>
      <div>
        <span>Route fees</span>
        <strong>{formatUsdAmount(quote.feeAmount)}</strong>
      </div>
      <p>Live LayerSwap quote · refreshed before a swap is created</p>
    </div>
  );
}

function OperationTimeline({ operation }: { operation: PrivacyOperation }) {
  const steps =
    operation.direction === "deposit"
      ? [
          "quote-ready",
          "swap-created",
          "source-submitted",
          "bridged-to-starknet",
          "private",
        ]
      : [
          "quote-ready",
          "swap-created",
          "private-withdrawal-submitted",
          "bridge-transfer-submitted",
          "ready-on-robinhood",
        ];
  const currentIndex = steps.indexOf(operation.state);
  return (
    <ol className="operation-timeline" aria-label="Operation progress">
      {steps.map((state, index) => (
        <li
          key={state}
          data-active={index <= currentIndex}
          data-current={index === currentIndex}
        >
          <i>{index < currentIndex ? "✓" : index + 1}</i>
          <span>{stateLabel(state)}</span>
        </li>
      ))}
      {operation.lastError ? (
        <li className="operation-attention">
          <Warning size={13} weight="fill" />
          <span>{operation.lastError}</span>
        </li>
      ) : null}
    </ol>
  );
}

function Gate({ title, children }: { title: string; children: string }) {
  return (
    <div className="deposit-gate">
      <LockKey size={17} weight="fill" />
      <p>
        <strong>{title}</strong>
        {children}
      </p>
    </div>
  );
}

function freshAccountIndex(): number {
  const words = crypto.getRandomValues(new Uint32Array(2));
  return Number(
    (BigInt(words[0]!) << 21n) | (BigInt(words[1]!) & ((1n << 21n) - 1n)),
  );
}

function requireMethod<T>(value: T | undefined, label: string): T {
  if (!value) throw new Error(`${label} is not configured`);
  return value;
}

function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    draft: "Draft",
    "quote-ready": "Route saved",
    "swap-created": "Order created",
    "source-submitted": "Wallet transfer sent",
    "bridged-to-starknet": "Arrived on Starknet",
    shielding: "Shielding",
    private: "Private balance ready",
    "private-withdrawal-submitted": "Private withdrawal sent",
    "transport-funded": "S2 funded",
    "bridge-transfer-submitted": "S2 bridge sent",
    "ready-on-robinhood": "R2 ready",
    refunding: "Refund in progress",
    refunded: "Refunded",
  };
  return labels[state] ?? state;
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : "Privacy route failed";
}

function shorten(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
