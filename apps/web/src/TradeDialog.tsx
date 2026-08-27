import { ArrowRightIcon as ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CheckCircleIcon as CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon as Refresh } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { LockKeyIcon as LockKey } from "@phosphor-icons/react/dist/csr/LockKey";
import { ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { TrendDownIcon as TrendDown } from "@phosphor-icons/react/dist/csr/TrendDown";
import { TrendUpIcon as TrendUp } from "@phosphor-icons/react/dist/csr/TrendUp";
import { WarningIcon as Warning } from "@phosphor-icons/react/dist/csr/Warning";
import { WalletIcon as Wallet } from "@phosphor-icons/react/dist/csr/Wallet";
import { XIcon as X } from "@phosphor-icons/react/dist/csr/X";
import { useState, type FormEvent } from "react";
import {
  type LayerswapDepositAction,
  type LayerswapFundingAction,
  type PonsOperationJournal,
  type PonsTradeIntent,
  type PrivacyOperation,
  type RelayExecutionRequest,
  type ResolvedPonsPrivacyRoute,
} from "@pons-privacy/sdk";
import { formatUnits, isAddress } from "viem";
import {
  formatUsdAmount,
  parseUsdAmount,
  type DepositQuoteApi,
} from "./deposit-api.js";
import type { PrivacyShieldRequest } from "./privacy-execution.js";
import type {
  TradeAccount,
  TradeApi,
  TradePosition,
  TradePreview,
} from "./trade-api.js";

type TradeMode = "buy" | "sell";

export function TradeDialog({
  api,
  depositApi,
  account,
  privacyConfigured,
  mainnetExecutionEnabled,
  tradeSubmissionEnabled,
  onConnect,
  onPrepareRoute,
  onOpenJournal,
  onQuotePrivateFee,
  onWithdrawToTransport,
  onSubmitFundingAction,
  onPrepareTradeRequest,
  onPrepareReturnRequest,
  onShieldReturn,
  onClose,
}: {
  api: TradeApi;
  depositApi: DepositQuoteApi;
  account: string | undefined;
  privacyConfigured: boolean;
  mainnetExecutionEnabled: boolean;
  tradeSubmissionEnabled: boolean;
  onConnect(): void;
  onPrepareRoute(accountIndex: number): Promise<ResolvedPonsPrivacyRoute>;
  onOpenJournal(): Promise<PonsOperationJournal>;
  onQuotePrivateFee(): Promise<bigint>;
  onWithdrawToTransport(
    route: ResolvedPonsPrivacyRoute,
    amount: bigint,
    recovery?: {
      readonly previousTransactionHash?: string;
      readonly onRelayStart?: () => void | Promise<void>;
      readonly onTransactionHash?: (hash: string) => void | Promise<void>;
    },
  ): Promise<string>;
  onSubmitFundingAction(
    route: ResolvedPonsPrivacyRoute,
    action: LayerswapFundingAction,
    recovery?: {
      readonly previousTransactionHash?: string;
      readonly onRelayStart?: () => void | Promise<void>;
      readonly onTransactionHash?: (hash: string) => void | Promise<void>;
    },
  ): Promise<string>;
  onPrepareTradeRequest(
    accountIndex: number,
    intent: PonsTradeIntent,
  ): Promise<RelayExecutionRequest>;
  onPrepareReturnRequest(
    accountIndex: number,
    swapId: string,
    actions: readonly LayerswapDepositAction[],
  ): Promise<RelayExecutionRequest>;
  onShieldReturn(
    route: ResolvedPonsPrivacyRoute,
    request: PrivacyShieldRequest,
  ): Promise<string>;
  onClose(): void;
}) {
  const [mode, setMode] = useState<TradeMode>("buy");
  const [token, setToken] = useState("");
  const [amount, setAmount] = useState("30");
  const [slippageBps, setSlippageBps] = useState(300);
  const [route, setRoute] = useState<ResolvedPonsPrivacyRoute>();
  const [operation, setOperation] = useState<PrivacyOperation>();
  const [preview, setPreview] = useState<TradePreview>();
  const [position, setPosition] = useState<TradePosition>();
  const [operations, setOperations] = useState<readonly PrivacyOperation[]>([]);
  const [activityOpen, setActivityOpen] = useState(false);
  const [privateFee, setPrivateFee] = useState<bigint>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [journal, setJournal] = useState<PonsOperationJournal>();

  async function requireJournal(): Promise<PonsOperationJournal> {
    if (journal) return journal;
    const opened = await onOpenJournal();
    setJournal(opened);
    return opened;
  }

  async function refreshOperations(current = journal) {
    if (!current) return;
    setOperations(
      (await current.list()).filter(
        (candidate) =>
          candidate.direction === "buy" || candidate.direction === "sell",
      ),
    );
  }

  function changeMode(next: TradeMode) {
    if (busy) return;
    setMode(next);
    setOperation(undefined);
    setRoute(undefined);
    setPreview(undefined);
    setPosition(undefined);
    setError(undefined);
    setActivityOpen(false);
  }

  async function reviewBuy(event: FormEvent) {
    event.preventDefault();
    if (!account) return onConnect();
    setBusy("review-buy");
    setError(undefined);
    try {
      if (!privacyConfigured)
        throw new Error("Privacy account setup is unavailable");
      if (!isAddress(token) || BigInt(token) === 0n) {
        throw new Error("Enter a valid Pons token address");
      }
      const amountIn = parseUsdAmount(amount);
      const accountIndex = freshAccountIndex();
      const nextRoute = await onPrepareRoute(accountIndex);
      const [quote, fee, tokenPosition] = await Promise.all([
        requireMethod(
          depositApi.quoteFunding,
          "Private buy funding quote",
        )(amountIn),
        onQuotePrivateFee(),
        api.position(nextRoute.robinhoodExecutionAccount, token),
      ]);
      if (amountIn <= fee) {
        throw new Error("Buy funding must exceed the STRK20 private fee");
      }
      const currentJournal = await requireJournal();
      const created = await currentJournal.create({
        direction: "buy",
        accountIndex,
        amount: amountIn,
        rootStarknetAddress: nextRoute.rootIdentity.starknetAddress,
        transportStarknetAddress: nextRoute.transportIdentity.starknetAddress,
        robinhoodExecutionAddress: nextRoute.robinhoodExecutionAccount,
        tokenAddress: tokenPosition.token,
        curveAddress: tokenPosition.curve,
        tokenSymbol: tokenPosition.tokenSymbol,
        tokenDecimals: tokenPosition.tokenDecimals,
        quoteExpiresAt: quote.expiresAt,
      });
      const ready = await currentJournal.advance(created.id, "quote-ready", {
        quoteExpiresAt: quote.expiresAt,
      });
      setRoute(nextRoute);
      setPosition(tokenPosition);
      setPrivateFee(fee);
      setOperation(ready);
      await refreshOperations(currentJournal);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function executeBuyFunding() {
    if (!operation || operation.direction !== "buy" || !route || !journal)
      return;
    setBusy("fund-buy");
    setError(undefined);
    try {
      requireExecution(mainnetExecutionEnabled, "Private value movement");
      const amountIn = BigInt(operation.amount);
      const prepared = await requireMethod(
        depositApi.createFundingSwap,
        "Private buy funding",
      )({
        operationId: operation.id,
        amountIn,
        sourceAddress: route.transportIdentity.starknetAddress,
        destinationAddress: route.robinhoodExecutionAccount,
      });
      let current = await journal.advance(operation.id, "swap-created", {
        swapId: prepared.swap.id,
      });
      setOperation(current);
      const privateTxHash = await withdrawBuyToTransport(current, route);
      current = await journal.advance(
        operation.id,
        "private-withdrawal-submitted",
        { privateTxHash },
      );
      setOperation(current);
      const transportTxHash = await submitBuyTransport(
        current,
        route,
        prepared.depositAction,
      );
      current = await journal.advance(operation.id, "transport-funded", {
        transportTxHash,
      });
      current = await journal.advance(
        operation.id,
        "bridge-transfer-submitted",
        { transportTxHash },
      );
      setOperation(current);
      await refreshOperations(journal);
    } catch (cause) {
      await recordFailure(cause);
    } finally {
      setBusy(undefined);
    }
  }

  async function continueBuyFunding() {
    if (!operation || operation.direction !== "buy" || !route || !journal)
      return;
    setBusy("continue-buy");
    setError(undefined);
    try {
      requireExecution(mainnetExecutionEnabled, "Private value movement");
      const amountIn = BigInt(operation.amount);
      const action = await requireMethod(
        depositApi.getFundingAction,
        "Private buy funding recovery",
      )(operation.swapId!, route.transportIdentity.starknetAddress, amountIn);
      let current = operation;
      if (current.state === "swap-created") {
        const privateTxHash = await withdrawBuyToTransport(current, route);
        current = await journal.advance(
          operation.id,
          "private-withdrawal-submitted",
          { privateTxHash },
        );
        setOperation(current);
      }
      if (current.state === "private-withdrawal-submitted") {
        const transportTxHash = await submitBuyTransport(
          current,
          route,
          action,
        );
        current = await journal.advance(operation.id, "transport-funded", {
          transportTxHash,
        });
        setOperation(current);
      }
      if (current.state === "transport-funded") {
        current = await journal.advance(
          operation.id,
          "bridge-transfer-submitted",
          current.transportTxHash
            ? { transportTxHash: current.transportTxHash }
            : {},
        );
      }
      setOperation(current);
      await refreshOperations(journal);
    } catch (cause) {
      await recordFailure(cause);
    } finally {
      setBusy(undefined);
    }
  }

  async function refreshBuyBridge() {
    if (!operation || operation.direction !== "buy" || !route || !journal)
      return;
    setBusy("buy-bridge");
    setError(undefined);
    try {
      const status = await requireMethod(
        depositApi.getFundingSwap,
        "Private buy bridge status",
      )(operation.swapId!, route.transportIdentity.starknetAddress);
      let current = operation;
      if (status.status === "completed") {
        if (!status.outputAmount || !status.outputTransactionHash) {
          throw new Error("LayerSwap completed without exact R2 delivery data");
        }
        current = await journal.advance(operation.id, "ready-on-robinhood", {
          destinationAmount: status.outputAmount.toString(),
          destinationTxHash: status.outputTransactionHash,
        });
        setOperation(current);
        await previewBuy(current);
      } else if (status.status === "pending_refund") {
        current = await journal.advance(operation.id, "refunding");
        setOperation(current);
      } else if (status.status === "failed" || status.status === "expired") {
        throw new Error(
          status.failReason ?? `LayerSwap status: ${status.status}`,
        );
      }
      await refreshOperations(journal);
    } catch (cause) {
      await recordFailure(cause);
    } finally {
      setBusy(undefined);
    }
  }

  async function withdrawBuyToTransport(
    candidate: PrivacyOperation,
    nextRoute: ResolvedPonsPrivacyRoute,
  ): Promise<string> {
    if (!journal) throw new Error("Private operation journal is unavailable");
    if (candidate.privateRelayStartedAt && !candidate.privateTxHash) {
      throw new Error(
        "The prior STRK20 withdrawal relay is unresolved; do not resubmit it",
      );
    }
    let current = candidate;
    const patch = async (
      value: Parameters<PonsOperationJournal["advance"]>[2],
    ) => {
      current = await journal.advance(candidate.id, candidate.state, value);
      setOperation(current);
    };
    return onWithdrawToTransport(nextRoute, BigInt(candidate.amount), {
      ...(candidate.privateTxHash
        ? { previousTransactionHash: candidate.privateTxHash }
        : {}),
      onRelayStart: () =>
        patch({ privateRelayStartedAt: Date.now() }).then(() => undefined),
      onTransactionHash: (hash) =>
        patch({ privateTxHash: hash }).then(() => undefined),
    });
  }

  async function submitBuyTransport(
    candidate: PrivacyOperation,
    nextRoute: ResolvedPonsPrivacyRoute,
    action: LayerswapFundingAction,
  ): Promise<string> {
    if (!journal) throw new Error("Private operation journal is unavailable");
    if (candidate.transportRelayStartedAt && !candidate.transportTxHash) {
      throw new Error("The prior S2 relay is unresolved; do not resubmit it");
    }
    let current = candidate;
    const patch = async (
      value: Parameters<PonsOperationJournal["advance"]>[2],
    ) => {
      current = await journal.advance(candidate.id, candidate.state, value);
      setOperation(current);
    };
    return onSubmitFundingAction(nextRoute, action, {
      ...(candidate.transportTxHash
        ? { previousTransactionHash: candidate.transportTxHash }
        : {}),
      onRelayStart: () =>
        patch({ transportRelayStartedAt: Date.now() }).then(() => undefined),
      onTransactionHash: (hash) =>
        patch({ transportTxHash: hash }).then(() => undefined),
    });
  }

  async function previewBuy(candidate = operation) {
    if (!candidate || candidate.direction !== "buy" || !route || !journal)
      return;
    if (
      !candidate.destinationAmount ||
      !candidate.tokenAddress ||
      !candidate.curveAddress
    ) {
      throw new Error("The private buy is missing its delivered USDG amount");
    }
    const result = await api.preview({
      side: "buy",
      token: candidate.tokenAddress,
      amount: BigInt(candidate.destinationAmount),
      slippageBps,
      account: tradeAccount(route, candidate.accountIndex),
    });
    const current = await journal.advance(candidate.id, "trade-previewed", {
      tradePreviewId: result.previewId,
      tradeAmountIn: result.amountIn.toString(),
      tradeAmountOut: result.expectedAmountOut.toString(),
    });
    setPreview(result);
    setOperation(current);
  }

  async function unlockPositions() {
    setBusy("positions");
    setError(undefined);
    try {
      const current = await requireJournal();
      await refreshOperations(current);
      setActivityOpen(true);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function reviewSell(source: PrivacyOperation) {
    if (source.direction !== "buy" || source.state !== "bought") return;
    setBusy("review-sell");
    setError(undefined);
    try {
      const nextRoute = await onPrepareRoute(source.accountIndex);
      assertSavedRoute(source, nextRoute);
      const tokenPosition = await api.position(
        nextRoute.robinhoodExecutionAccount,
        source.tokenAddress!,
      );
      if (tokenPosition.tokenBalance <= 0n) {
        throw new Error("This private position no longer holds Pons tokens");
      }
      const result = await api.preview({
        side: "sell",
        token: source.tokenAddress!,
        amount: tokenPosition.tokenBalance,
        slippageBps,
        account: tradeAccount(nextRoute, source.accountIndex),
      });
      const currentJournal = await requireJournal();
      const created = await currentJournal.create({
        direction: "sell",
        accountIndex: source.accountIndex,
        amount: tokenPosition.tokenBalance,
        rootStarknetAddress: nextRoute.rootIdentity.starknetAddress,
        returnStarknetAddress: nextRoute.returnIdentity.starknetAddress,
        robinhoodExecutionAddress: nextRoute.robinhoodExecutionAccount,
        tokenAddress: tokenPosition.token,
        curveAddress: tokenPosition.curve,
        tokenSymbol: tokenPosition.tokenSymbol,
        tokenDecimals: tokenPosition.tokenDecimals,
        sourceOperationId: source.id,
      });
      const ready = await currentJournal.advance(
        created.id,
        "trade-previewed",
        {
          tradePreviewId: result.previewId,
          tradeAmountIn: result.amountIn.toString(),
          tradeAmountOut: result.expectedAmountOut.toString(),
        },
      );
      setMode("sell");
      setRoute(nextRoute);
      setPosition(tokenPosition);
      setPreview(result);
      setOperation(ready);
      setActivityOpen(false);
      await refreshOperations(currentJournal);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function submitTrade() {
    if (!operation || !route || !preview || !journal) return;
    if (operation.evmRelayStartedAt && !operation.tradeTxHash) {
      setError(
        "The prior trade relay is unresolved; check the relayer before resubmitting.",
      );
      return;
    }
    setBusy("submit-trade");
    setError(undefined);
    try {
      requireExecution(tradeSubmissionEnabled, "Private Pons trading");
      const intent: PonsTradeIntent =
        preview.side === "buy"
          ? {
              side: "buy",
              value: {
                token: preview.token as `0x${string}`,
                curve: preview.curve as `0x${string}`,
                quoteIn: preview.amountIn,
                slippageBps: preview.slippageBps,
              },
            }
          : {
              side: "sell",
              value: {
                token: preview.token as `0x${string}`,
                curve: preview.curve as `0x${string}`,
                tokensIn: preview.amountIn,
                slippageBps: preview.slippageBps,
              },
            };
      const request = await onPrepareTradeRequest(
        operation.accountIndex,
        intent,
      );
      let current = await journal.advance(operation.id, "trade-previewed", {
        evmRelayStartedAt: Date.now(),
      });
      setOperation(current);
      const submitted = await api.submit(preview.previewId, request);
      if (!submitted.transactionHash) {
        throw new Error(
          "Trade relayer accepted the request without a transaction hash",
        );
      }
      current = await journal.advance(operation.id, "trade-submitted", {
        tradeTxHash: submitted.transactionHash,
      });
      setOperation(current);
      await refreshOperations(journal);
    } catch (cause) {
      await recordFailure(cause);
    } finally {
      setBusy(undefined);
    }
  }

  async function refreshTrade() {
    if (!operation || !route || !journal || !operation.tradeTxHash) return;
    setBusy("trade-status");
    setError(undefined);
    try {
      const status = await api.status(
        operation.tradeTxHash,
        route.robinhoodExecutionAccount,
        operation.tokenAddress!,
      );
      if (status.status === "reverted") throw new Error("Pons trade reverted");
      if (status.status === "success" && status.position) {
        if (operation.direction === "buy") {
          const current = await journal.advance(operation.id, "bought", {
            tradeAmountOut: status.position.tokenBalance.toString(),
          });
          setOperation(current);
          setPosition(status.position);
        } else if (operation.direction === "sell") {
          if (status.position.usdgBalance <= 0n) {
            throw new Error("The completed sell produced no recoverable USDG");
          }
          const current = await journal.advance(
            operation.id,
            "sold-on-robinhood",
            { tradeAmountOut: status.position.usdgBalance.toString() },
          );
          setOperation(current);
          setPosition(status.position);
        }
      }
      await refreshOperations(journal);
    } catch (cause) {
      await recordFailure(cause);
    } finally {
      setBusy(undefined);
    }
  }

  async function createSellReturnSwap() {
    if (!operation || operation.direction !== "sell" || !route || !journal)
      return;
    setBusy("return-swap");
    setError(undefined);
    try {
      requireExecution(mainnetExecutionEnabled, "Private sale return");
      if (!operation.tradeAmountOut)
        throw new Error("Sale USDG balance is unavailable");
      const amountIn = BigInt(operation.tradeAmountOut);
      const prepared = await requireMethod(
        depositApi.createDepositSwap,
        "Private sale return swap",
      )({
        operationId: operation.id,
        amountIn,
        sourceAddress: route.robinhoodExecutionAccount,
        destinationAddress: route.returnIdentity.starknetAddress,
      });
      const current = await journal.advance(operation.id, "swap-created", {
        swapId: prepared.swap.id,
        quoteExpiresAt: prepared.quote.expiresAt,
      });
      setOperation(current);
      await relaySellReturn(current, prepared.depositActions);
    } catch (cause) {
      await recordFailure(cause);
    } finally {
      setBusy(undefined);
    }
  }

  async function relaySellReturn(
    candidate = operation,
    preparedActions?: readonly LayerswapDepositAction[],
  ) {
    if (!candidate || candidate.direction !== "sell" || !route || !journal)
      return;
    if (candidate.evmRelayStartedAt && !candidate.sourceTxHash) {
      throw new Error(
        "The prior R2 return relay is unresolved; do not resubmit it",
      );
    }
    const amountIn = BigInt(candidate.tradeAmountOut!);
    const actions =
      preparedActions ??
      (await requireMethod(
        depositApi.getDepositActions,
        "Private sale return recovery",
      )(candidate.swapId!, route.robinhoodExecutionAccount, amountIn));
    const request = await onPrepareReturnRequest(
      candidate.accountIndex,
      candidate.swapId!,
      actions,
    );
    let current = await journal.advance(candidate.id, "swap-created", {
      evmRelayStartedAt: Date.now(),
    });
    setOperation(current);
    const sourceTxHash = await requireMethod(
      depositApi.submitReturnRequest,
      "R2 LayerSwap return relay",
    )(candidate.swapId!, route.robinhoodExecutionAccount, request);
    current = await journal.advance(candidate.id, "source-submitted", {
      sourceTxHash,
    });
    setOperation(current);
    await refreshOperations(journal);
  }

  async function refreshSellBridge() {
    if (!operation || operation.direction !== "sell" || !route || !journal)
      return;
    setBusy("sell-bridge");
    setError(undefined);
    try {
      const status = await requireMethod(
        depositApi.getDepositSwap,
        "Private sale bridge status",
      )(operation.swapId!, route.robinhoodExecutionAccount);
      let current = operation;
      if (status.status === "completed") {
        if (!status.outputAmount || !status.outputTransactionHash) {
          throw new Error("LayerSwap completed without exact S3 delivery data");
        }
        current = await journal.advance(operation.id, "bridged-to-starknet", {
          destinationAmount: status.outputAmount.toString(),
          destinationTxHash: status.outputTransactionHash,
        });
        setOperation(current);
        await shieldSellReturn(current);
      } else if (status.status === "pending_refund") {
        current = await journal.advance(operation.id, "refunding");
        setOperation(current);
      } else if (status.status === "failed" || status.status === "expired") {
        throw new Error(
          status.failReason ?? `LayerSwap status: ${status.status}`,
        );
      }
      await refreshOperations(journal);
    } catch (cause) {
      await recordFailure(cause);
    } finally {
      setBusy(undefined);
    }
  }

  async function shieldSellReturn(candidate = operation) {
    if (!candidate || candidate.direction !== "sell" || !route || !journal)
      return;
    if (!candidate.destinationAmount || !candidate.destinationTxHash) {
      throw new Error("The S3 return must be reconciled before shielding");
    }
    if (candidate.privateRelayStartedAt && !candidate.privateTxHash) {
      throw new Error(
        "The prior STRK20 return relay is unresolved; do not resubmit it",
      );
    }
    let current =
      candidate.state === "bridged-to-starknet"
        ? await journal.advance(candidate.id, "shielding")
        : candidate;
    setOperation(current);
    const patch = async (
      value: Parameters<PonsOperationJournal["advance"]>[2],
    ) => {
      current = await journal.advance(candidate.id, "shielding", value);
      setOperation(current);
    };
    const privateTxHash = await onShieldReturn(route, {
      amount: BigInt(candidate.destinationAmount),
      fundingTransactionHash: candidate.destinationTxHash,
      ...(candidate.accountDeploymentTxHash
        ? {
            previousDeploymentTransactionHash:
              candidate.accountDeploymentTxHash,
          }
        : {}),
      ...(candidate.privateTxHash
        ? { previousPrivateTransactionHash: candidate.privateTxHash }
        : {}),
      onDeploymentTransactionHash: (hash) =>
        patch({ accountDeploymentTxHash: hash }).then(() => undefined),
      onPrivateRelayStart: () =>
        patch({ privateRelayStartedAt: Date.now() }).then(() => undefined),
      onPrivateTransactionHash: (hash) =>
        patch({ privateTxHash: hash }).then(() => undefined),
    });
    current = await journal.advance(candidate.id, "private", { privateTxHash });
    setOperation(current);
    await refreshOperations(journal);
  }

  async function resume(candidate: PrivacyOperation) {
    if (candidate.direction !== "buy" && candidate.direction !== "sell") return;
    setBusy("resume");
    setError(undefined);
    try {
      const nextRoute = await onPrepareRoute(candidate.accountIndex);
      assertSavedRoute(candidate, nextRoute);
      setMode(candidate.direction);
      setRoute(nextRoute);
      setToken(candidate.tokenAddress ?? "");
      setOperation(candidate);
      setPreview(undefined);
      setActivityOpen(false);
      if (candidate.state === "trade-previewed") {
        const result = await api.preview({
          side: candidate.direction,
          token: candidate.tokenAddress!,
          amount: BigInt(candidate.tradeAmountIn ?? candidate.amount),
          slippageBps,
          account: tradeAccount(nextRoute, candidate.accountIndex),
        });
        const currentJournal = await requireJournal();
        const updated = await currentJournal.advance(
          candidate.id,
          "trade-previewed",
          {
            tradePreviewId: result.previewId,
            tradeAmountOut: result.expectedAmountOut.toString(),
          },
        );
        setPreview(result);
        setOperation(updated);
      }
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function recordFailure(cause: unknown) {
    const errorMessage = message(cause);
    setError(errorMessage);
    if (journal && operation) {
      try {
        setOperation(await journal.recordError(operation.id, errorMessage));
      } catch {
        // Preserve the actionable in-memory error.
      }
    }
  }

  const boughtPositions = operations.filter(
    (candidate) =>
      candidate.direction === "buy" && candidate.state === "bought",
  );
  const action = operationAction(operation);

  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="deposit-dialog trade-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="trade-title"
      >
        <header className="deposit-header trade-header">
          <div className="deposit-title-mark">
            <ShieldCheck size={21} weight="fill" />
          </div>
          <div>
            <p className="dialog-overline">Pons private market</p>
            <h2 id="trade-title">Trade without exposing your root wallet.</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close private trading"
          >
            <X size={18} />
          </button>
        </header>

        <div
          className="privacy-flow-tabs"
          role="tablist"
          aria-label="Private trade side"
        >
          <button
            type="button"
            role="tab"
            aria-selected={mode === "buy"}
            onClick={() => changeMode("buy")}
          >
            <TrendUp size={15} /> Buy privately
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === "sell"}
            onClick={() => changeMode("sell")}
          >
            <TrendDown size={15} /> Sell privately
          </button>
        </div>

        <div className="trade-privacy-map" aria-label="Trade privacy route">
          {mode === "buy" ? (
            <>
              <span>private USDC</span>
              <i>STRK20</i>
              <span>fresh R2</span>
              <i>Pons</i>
              <strong>tokens</strong>
            </>
          ) : (
            <>
              <span>tokens in R2</span>
              <i>Pons</i>
              <span>USDG</span>
              <i>STRK20</i>
              <strong>private USDC</strong>
            </>
          )}
        </div>

        <button
          className="activity-button"
          type="button"
          disabled={Boolean(busy)}
          onClick={() => void unlockPositions()}
        >
          <Refresh size={14} /> Private positions & recovery
        </button>

        {activityOpen ? (
          <div className="trade-positions">
            {operations.length ? (
              operations.map((candidate) => (
                <article key={candidate.id}>
                  <div>
                    <strong>{candidate.tokenSymbol ?? "Pons token"}</strong>
                    <small>
                      {candidate.direction} · {stateLabel(candidate.state)}
                    </small>
                  </div>
                  <code>
                    {shorten(candidate.robinhoodExecutionAddress ?? "")}
                  </code>
                  {candidate.direction === "buy" &&
                  candidate.state === "bought" ? (
                    <button
                      type="button"
                      onClick={() => void reviewSell(candidate)}
                    >
                      Sell all privately
                    </button>
                  ) : !["private", "refunded"].includes(candidate.state) ? (
                    <button
                      type="button"
                      onClick={() => void resume(candidate)}
                    >
                      Resume
                    </button>
                  ) : null}
                </article>
              ))
            ) : (
              <p>No private trade operations for this wallet.</p>
            )}
          </div>
        ) : !operation && mode === "buy" ? (
          <form className="deposit-form trade-form" onSubmit={reviewBuy}>
            <label htmlFor="trade-token">Pons token address</label>
            <input
              id="trade-token"
              aria-label="Pons token address"
              value={token}
              onChange={(event) => setToken(event.target.value.trim())}
              placeholder="0x…"
              autoComplete="off"
            />
            <label htmlFor="trade-amount">
              Private USDC to route into the buy
            </label>
            <div className="deposit-amount-field">
              <input
                id="trade-amount"
                aria-label="Private buy amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                autoComplete="off"
              />
              <span>
                <i>$</i> USDC
              </span>
            </div>
            <Slippage value={slippageBps} onChange={setSlippageBps} />
            {error ? <ErrorMessage value={error} /> : null}
            {!account ? (
              <button
                className="primary-button deposit-primary"
                type="button"
                onClick={onConnect}
              >
                Connect wallet <Wallet size={17} />
              </button>
            ) : (
              <button
                className="primary-button deposit-primary"
                type="submit"
                disabled={Boolean(busy)}
              >
                {busy === "review-buy"
                  ? "Building private route…"
                  : "Review private buy"}
                <ArrowRight size={17} />
              </button>
            )}
          </form>
        ) : !operation && mode === "sell" ? (
          <div className="trade-empty-state">
            <TrendDown size={26} />
            <h3>Select a private position</h3>
            <p>
              Unlock the encrypted journal, then choose a completed R2 position.
              The MVP sells the full position and shields every recovered USDG.
            </p>
            <button
              className="primary-button deposit-primary"
              type="button"
              onClick={() => void unlockPositions()}
              disabled={Boolean(busy)}
            >
              {busy === "positions"
                ? "Unlocking…"
                : `Load positions${boughtPositions.length ? ` (${boughtPositions.length})` : ""}`}
            </button>
          </div>
        ) : (
          <div className="trade-operation">
            <div className="trade-operation-title">
              <span
                className={
                  operation?.direction === "buy" ? "buy-mark" : "sell-mark"
                }
              >
                {operation?.direction === "buy" ? (
                  <TrendUp size={17} />
                ) : (
                  <TrendDown size={17} />
                )}
              </span>
              <div>
                <small>
                  {operation?.direction === "buy"
                    ? "Private buy"
                    : "Private sell"}
                </small>
                <strong>{operation?.tokenSymbol ?? "Pons token"}</strong>
              </div>
              <code>{shorten(operation?.tokenAddress ?? "")}</code>
            </div>
            {route ? (
              <div className="fresh-route-proof">
                <span>
                  <small>Isolated Pons account · R2</small>
                  <code>{shorten(route.robinhoodExecutionAccount)}</code>
                </span>
                <ArrowRight size={13} />
                <span>
                  <small>
                    {operation?.direction === "buy"
                      ? "Funded from fresh S2"
                      : "Returns through fresh S3"}
                  </small>
                  <code>
                    {shorten(
                      operation?.direction === "buy"
                        ? route.transportIdentity.starknetAddress
                        : route.returnIdentity.starknetAddress,
                    )}
                  </code>
                </span>
              </div>
            ) : null}
            {privateFee !== undefined && operation?.direction === "buy" ? (
              <p className="trade-fee-note">
                Private execution fee: {formatUsdAmount(privateFee)} USDC
              </p>
            ) : null}
            {preview ? <TradeQuote preview={preview} /> : null}
            {position && operation?.direction === "sell" ? (
              <p className="trade-fee-note">
                Selling all{" "}
                {formatUnits(position.tokenBalance, position.tokenDecimals)}{" "}
                {position.tokenSymbol}
              </p>
            ) : null}
            {operation ? <TradeTimeline operation={operation} /> : null}
            {error ? <ErrorMessage value={error} /> : null}
            <TradeAction
              action={action}
              busy={busy}
              enabled={
                mainnetExecutionEnabled &&
                (action !== "submit-trade" || tradeSubmissionEnabled)
              }
              onClick={() => {
                if (action === "fund-buy") void executeBuyFunding();
                else if (action === "continue-buy") void continueBuyFunding();
                else if (action === "refresh-buy-bridge")
                  void refreshBuyBridge();
                else if (action === "preview-buy") void previewBuy();
                else if (action === "submit-trade") void submitTrade();
                else if (action === "refresh-trade") void refreshTrade();
                else if (action === "return-swap") void createSellReturnSwap();
                else if (action === "relay-return") void relaySellReturn();
                else if (action === "refresh-sell-bridge")
                  void refreshSellBridge();
                else if (action === "shield-return") void shieldSellReturn();
              }}
            />
            {operation?.state === "bought" ? (
              <Ready title="Private buy complete">
                The Pons position is held by isolated R2. Only R2, amount, price
                and timing are public.
              </Ready>
            ) : null}
            {operation?.direction === "sell" &&
            operation.state === "private" ? (
              <Ready title="Sale proceeds are private">
                The returned USDC is shielded under S3's independent viewing key
                and no longer linked to a future withdrawal.
              </Ready>
            ) : null}
          </div>
        )}

        <p className="deposit-footnote">
          STRK20 hides the funding and destination graph—not the Pons trade
          itself. R2, token, amount, price and timing remain public.
        </p>
      </section>
    </div>
  );
}

type TradeActionName =
  | "fund-buy"
  | "continue-buy"
  | "refresh-buy-bridge"
  | "preview-buy"
  | "submit-trade"
  | "refresh-trade"
  | "return-swap"
  | "relay-return"
  | "refresh-sell-bridge"
  | "shield-return"
  | undefined;

function operationAction(
  operation: PrivacyOperation | undefined,
): TradeActionName {
  if (!operation) return undefined;
  if (operation.direction === "buy") {
    if (operation.state === "quote-ready") return "fund-buy";
    if (
      [
        "swap-created",
        "private-withdrawal-submitted",
        "transport-funded",
      ].includes(operation.state)
    )
      return "continue-buy";
    if (operation.state === "bridge-transfer-submitted")
      return "refresh-buy-bridge";
    if (operation.state === "ready-on-robinhood") return "preview-buy";
    if (operation.state === "trade-previewed") return "submit-trade";
    if (operation.state === "trade-submitted") return "refresh-trade";
  }
  if (operation.direction === "sell") {
    if (operation.state === "trade-previewed") return "submit-trade";
    if (operation.state === "trade-submitted") return "refresh-trade";
    if (operation.state === "sold-on-robinhood") return "return-swap";
    if (operation.state === "swap-created") return "relay-return";
    if (operation.state === "source-submitted") return "refresh-sell-bridge";
    if (
      operation.state === "bridged-to-starknet" ||
      operation.state === "shielding"
    )
      return "shield-return";
  }
  return undefined;
}

const ACTION_LABELS: Record<Exclude<TradeActionName, undefined>, string> = {
  "fund-buy": "Route private funds to buyer",
  "continue-buy": "Continue private funding",
  "refresh-buy-bridge": "Check buyer funding",
  "preview-buy": "Refresh Pons buy quote",
  "submit-trade": "Confirm private trade",
  "refresh-trade": "Check Pons transaction",
  "return-swap": "Return sale proceeds privately",
  "relay-return": "Continue USDG return",
  "refresh-sell-bridge": "Check proceeds return",
  "shield-return": "Shield returned USDC",
};

function TradeAction({
  action,
  busy,
  enabled,
  onClick,
}: {
  action: TradeActionName;
  busy: string | undefined;
  enabled: boolean;
  onClick(): void;
}) {
  if (!action) return null;
  return enabled ? (
    <button
      className="primary-button deposit-primary"
      type="button"
      disabled={Boolean(busy)}
      onClick={onClick}
    >
      {busy ? "Working securely…" : ACTION_LABELS[action]}{" "}
      {!busy ? <ArrowRight size={17} /> : null}
    </button>
  ) : (
    <div className="deposit-gate">
      <LockKey size={17} />
      <p>
        <strong>Mainnet trade gate locked</strong>The route is saved, but
        broadcast remains disabled.
      </p>
    </div>
  );
}

function TradeQuote({ preview }: { preview: TradePreview }) {
  const input =
    preview.side === "buy"
      ? `${formatUsdAmount(preview.amountIn)} USDG`
      : `${formatUnits(preview.amountIn, preview.tokenDecimals)} ${preview.tokenSymbol}`;
  const output =
    preview.side === "buy"
      ? `${formatUnits(preview.expectedAmountOut, preview.tokenDecimals)} ${preview.tokenSymbol}`
      : `${formatUsdAmount(preview.expectedAmountOut)} USDG`;
  const minimum =
    preview.side === "buy"
      ? `${formatUnits(preview.minimumAmountOut, preview.tokenDecimals)} ${preview.tokenSymbol}`
      : `${formatUsdAmount(preview.minimumAmountOut)} USDG`;
  return (
    <div className="deposit-quote trade-quote">
      <div>
        <span>You trade</span>
        <strong>{input}</strong>
      </div>
      <div>
        <span>Expected</span>
        <strong>≈ {output}</strong>
      </div>
      <div>
        <span>Minimum</span>
        <strong>{minimum}</strong>
      </div>
      <p>
        Live Pons curve quote · {(preview.slippageBps / 100).toFixed(2)}%
        slippage ceiling
      </p>
    </div>
  );
}

function TradeTimeline({ operation }: { operation: PrivacyOperation }) {
  const steps =
    operation.direction === "buy"
      ? [
          "quote-ready",
          "private-withdrawal-submitted",
          "bridge-transfer-submitted",
          "trade-previewed",
          "trade-submitted",
          "bought",
        ]
      : [
          "trade-previewed",
          "trade-submitted",
          "sold-on-robinhood",
          "source-submitted",
          "shielding",
          "private",
        ];
  const index = steps.indexOf(operation.state);
  return (
    <ol className="operation-timeline" aria-label="Private trade progress">
      {steps.map((step, stepIndex) => (
        <li
          key={step}
          data-active={stepIndex <= index}
          data-current={stepIndex === index}
        >
          <i>{stepIndex < index ? "✓" : stepIndex + 1}</i>
          <span>{stateLabel(step)}</span>
        </li>
      ))}
      {operation.lastError ? (
        <li className="operation-attention">
          <Warning size={13} />
          <span>{operation.lastError}</span>
        </li>
      ) : null}
    </ol>
  );
}

function Slippage({
  value,
  onChange,
}: {
  value: number;
  onChange(value: number): void;
}) {
  return (
    <div className="trade-slippage">
      <span>
        <strong>Slippage limit</strong>
        <small>The request fails before accepting a weaker quote.</small>
      </span>
      <select
        aria-label="Trade slippage"
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
      >
        <option value={100}>1%</option>
        <option value={300}>3%</option>
        <option value={500}>5%</option>
      </select>
    </div>
  );
}

function ErrorMessage({ value }: { value: string }) {
  return (
    <div className="deposit-error" role="alert">
      <Warning size={16} weight="fill" /> {value}
    </div>
  );
}

function Ready({ title, children }: { title: string; children: string }) {
  return (
    <div className="privacy-ready">
      <CheckCircle size={20} weight="fill" />
      <p>
        <strong>{title}</strong>
        {children}
      </p>
    </div>
  );
}

function tradeAccount(
  route: ResolvedPonsPrivacyRoute,
  accountIndex: number,
): TradeAccount {
  return {
    account: route.robinhoodExecutionAccount,
    owner: route.robinhoodExecution.address,
    accountIndex,
  };
}

function assertSavedRoute(
  operation: PrivacyOperation,
  route: ResolvedPonsPrivacyRoute,
) {
  if (
    operation.robinhoodExecutionAddress?.toLowerCase() !==
      route.robinhoodExecutionAccount.toLowerCase() ||
    (operation.transportStarknetAddress &&
      BigInt(operation.transportStarknetAddress) !==
        BigInt(route.transportIdentity.starknetAddress)) ||
    (operation.returnStarknetAddress &&
      BigInt(operation.returnStarknetAddress) !==
        BigInt(route.returnIdentity.starknetAddress))
  ) {
    throw new Error(
      "Saved private trade no longer matches its derived accounts",
    );
  }
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

function requireExecution(enabled: boolean, label: string) {
  if (!enabled) throw new Error(`${label} is locked`);
}

function stateLabel(value: string): string {
  return value.replaceAll("-", " ");
}

function shorten(value: string): string {
  return value.length > 13 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
}

function message(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : "The private trade could not continue";
}
