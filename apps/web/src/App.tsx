import { ArrowRightIcon as ArrowRight } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { CheckIcon as Check } from "@phosphor-icons/react/dist/csr/Check";
import { CheckCircleIcon as CheckCircle } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { GlobeSimpleIcon as GlobeSimple } from "@phosphor-icons/react/dist/csr/GlobeSimple";
import { ImageSquareIcon as ImageSquare } from "@phosphor-icons/react/dist/csr/ImageSquare";
import { LockKeyIcon as LockKey } from "@phosphor-icons/react/dist/csr/LockKey";
import { RocketLaunchIcon as RocketLaunch } from "@phosphor-icons/react/dist/csr/RocketLaunch";
import { ShieldCheckIcon as ShieldCheck } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { SparkleIcon as Sparkle } from "@phosphor-icons/react/dist/csr/Sparkle";
import { WarningIcon as Warning } from "@phosphor-icons/react/dist/csr/Warning";
import { XIcon as X } from "@phosphor-icons/react/dist/csr/X";
import {
  useMemo,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import type {
  LaunchApi,
  LaunchDraft,
  LaunchPreview,
  LaunchSubmission,
} from "./launch-api.js";

interface AppProps {
  api: LaunchApi;
  apiMode: "demo" | "live";
  launchEnabled: boolean;
}

type DraftErrors = Partial<
  Record<"name" | "symbol" | "logo" | "description", string>
>;

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

export function App({ api, apiMode, launchEnabled }: AppProps) {
  const [draft, setDraft] = useState<LaunchDraft>(emptyDraft);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [preview, setPreview] = useState<LaunchPreview>();
  const [submission, setSubmission] = useState<LaunchSubmission>();
  const [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<"preview" | "submit">();
  const [error, setError] = useState<string>();

  const errors = useMemo(() => validateDraft(draft), [draft]);
  const valid = Object.keys(errors).length === 0;
  const symbol = draft.symbol.trim().toUpperCase();
  const monogram = symbol.slice(0, 2) || "P?";

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
      const result = await api.preview({
        ...draft,
        name: draft.name.trim(),
        symbol,
      });
      setPreview(result);
      setAcknowledged(false);
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(undefined);
    }
  }

  async function submit() {
    if (!preview || !acknowledged || !launchEnabled || busy) return;
    setBusy("submit");
    setError(undefined);
    try {
      const result = await api.submit(
        { ...draft, name: draft.name.trim(), symbol },
        preview.previewId,
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
  }

  function reset() {
    setDraft(emptyDraft);
    setSubmission(undefined);
    setPreview(undefined);
    setAcknowledged(false);
    setError(undefined);
  }

  return (
    <div className="app-shell">
      <div className="grain" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Pons Privacy home">
          <span className="brand-mark">P</span>
          <span className="brand-copy">
            <strong>Pons Privacy</strong>
            <small>STRK20 sanitization layer</small>
          </span>
        </a>
        <nav aria-label="Primary navigation">
          <a href="#launch">Launch</a>
          <a href="#privacy">Privacy model</a>
          <a
            href="https://robinhood.ponslaunchpad.com/"
            target="_blank"
            rel="noreferrer"
          >
            Explore Pons <ArrowRight size={13} />
          </a>
        </nav>
        <div className="session-chip" data-mode={apiMode}>
          <span className="pulse" aria-hidden="true" />
          <span>
            <small>
              {apiMode === "demo" ? "Preview build" : "Private session"}
            </small>
            <strong>No wallet prompt</strong>
          </span>
        </div>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-index" aria-hidden="true">
            PP / 01
          </div>
          <div className="hero-copy">
            <p className="eyebrow">
              <span>Robinhood Chain</span>
              <i />
              <span>Pons V2</span>
            </p>
            <h1 id="hero-title">
              Launch without bringing
              <span>your wallet along.</span>
            </h1>
            <p className="hero-lede">
              Your token launches through a fresh execution account. The
              project-held privacy service holds the Starknet keys, orchestrates
              proofs when required, and submits on Robinhood—no Ready, Xverse,
              or Robinhood wallet confirmation required.
            </p>
          </div>
          <div className="hero-proof">
            <ShieldCheck size={25} weight="fill" />
            <div>
              <strong>Root-wallet unlinkability</strong>
              <p>
                Pons receives the fresh execution account as creator and fee
                recipient.
              </p>
            </div>
          </div>
        </section>

        <section className="workspace" id="launch">
          <form className="launch-sheet" onSubmit={review} noValidate>
            <div className="sheet-heading">
              <div>
                <p className="section-number">01 — Token dossier</p>
                <h2>Shape the public launch.</h2>
              </div>
              <span className="draft-stamp">Unsaved draft</span>
            </div>

            {error ? (
              <div className="error-banner" role="alert">
                <Warning size={18} weight="fill" />
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(undefined)}
                  aria-label="Dismiss error"
                >
                  <X size={15} />
                </button>
              </div>
            ) : null}

            <div className="identity-grid">
              <div className="token-art" data-has-image={Boolean(draft.logo)}>
                <span>{monogram}</span>
                <small>
                  {draft.logo ? "Artwork linked" : "Artwork preview"}
                </small>
              </div>
              <div className="field-stack">
                <Field
                  id="name"
                  label="Token name"
                  hint={`${encoder.encode(draft.name).length}/64 bytes`}
                  error={errors.name}
                >
                  <input
                    id="name"
                    name="name"
                    aria-label="Token name"
                    value={draft.name}
                    onChange={(event) => update("name", event.target.value)}
                    placeholder="Night Market"
                    autoComplete="off"
                    maxLength={64}
                  />
                </Field>
                <Field
                  id="symbol"
                  label="Ticker"
                  hint={`${encoder.encode(symbol).length}/16 bytes`}
                  error={errors.symbol}
                >
                  <div className="ticker-input">
                    <span>$</span>
                    <input
                      id="symbol"
                      name="symbol"
                      aria-label="Ticker"
                      value={draft.symbol}
                      onChange={(event) =>
                        update("symbol", event.target.value.toUpperCase())
                      }
                      placeholder="NITE"
                      autoComplete="off"
                      maxLength={16}
                    />
                  </div>
                </Field>
              </div>
            </div>

            <Field
              id="description"
              label="Description"
              hint={`${encoder.encode(draft.description).length}/2048 bytes`}
              error={errors.description}
            >
              <textarea
                id="description"
                name="description"
                value={draft.description}
                onChange={(event) => update("description", event.target.value)}
                placeholder="Give the market something worth remembering."
                rows={4}
                maxLength={2_048}
              />
            </Field>

            <Field
              id="logo"
              label="Artwork URL"
              hint="IPFS or HTTPS · backend-validated"
              error={errors.logo}
              icon={<ImageSquare size={16} />}
            >
              <input
                id="logo"
                name="logo"
                type="url"
                value={draft.logo}
                onChange={(event) => update("logo", event.target.value)}
                placeholder="https://…"
                maxLength={512}
              />
            </Field>

            <div className="divider" />

            <div className="sheet-heading compact">
              <div>
                <p className="section-number">02 — Creator economics</p>
                <h2>Set the durable rules.</h2>
              </div>
              <span className="protocol-pill">Pons config 0</span>
            </div>

            <div className="economics-grid">
              <div className="tax-control">
                <div className="control-label">
                  <span>Creator tax</span>
                  <strong>{(draft.creatorTaxBps / 100).toFixed(2)}%</strong>
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
                <div className="range-labels">
                  <span>0%</span>
                  <span>Live maximum 10%</span>
                </div>
              </div>

              <button
                type="button"
                className="toggle-card"
                role="switch"
                aria-checked={draft.buybackEnabled}
                onClick={() => update("buybackEnabled", !draft.buybackEnabled)}
              >
                <span className="toggle-copy">
                  <strong>Buyback vault</strong>
                  <small>
                    Route the configured share toward protocol buybacks.
                  </small>
                </span>
                <span
                  className="switch"
                  data-on={draft.buybackEnabled}
                  aria-hidden="true"
                >
                  <i />
                </span>
              </button>
            </div>

            <button
              type="button"
              className="advanced-toggle"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((open) => !open)}
            >
              <span>
                <GlobeSimple size={16} /> Social links
              </span>
              <span>{advancedOpen ? "Close" : "Add optional links"}</span>
            </button>

            {advancedOpen ? (
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
            ) : null}

            <div className="form-action">
              <div className="action-copy">
                <LockKey size={17} />
                <span>
                  <strong>No secret enters this browser.</strong>
                  <small>
                    The relayer credential and custody keys stay on the backend.
                  </small>
                </span>
              </div>
              <button
                className="primary-button"
                type="submit"
                disabled={!valid || Boolean(busy)}
              >
                {busy === "preview"
                  ? "Checking live Pons state…"
                  : "Review launch"}
                {busy !== "preview" ? (
                  <ArrowRight size={17} weight="bold" />
                ) : null}
              </button>
            </div>
          </form>

          <aside className="route-panel" aria-label="Privacy route summary">
            <div className="route-heading">
              <p className="section-number">Route receipt</p>
              <span className="live-indicator">
                <i /> Mainnet
              </span>
            </div>

            <div className="token-receipt">
              <div className="receipt-art">
                <span>{monogram}</span>
              </div>
              <div>
                <small>Launch candidate</small>
                <strong>{draft.name.trim() || "Untitled token"}</strong>
                <span>${symbol || "TICKER"}</span>
              </div>
            </div>

            <ol className="route-steps">
              <RouteStep
                index="01"
                title="Project-held session"
                description="Your authenticated app session authorizes the request. No Starknet wallet opens."
                active
              />
              <RouteStep
                index="02"
                title="Fresh execution account"
                description="A counterfactual Robinhood account becomes the public Pons creator."
                active={Boolean(preview || submission)}
              />
              <RouteStep
                index="03"
                title="Pons V2 launch"
                description="The policy relayer pins live economics, simulates, and submits the exact call."
                active={Boolean(submission)}
              />
            </ol>

            <div className="cost-ledger">
              <LedgerRow label="Pons launch fee" value="0.0005 ETH" />
              <LedgerRow label="Pair asset" value="USDG" />
              <LedgerRow label="Network" value="Robinhood · 4663" />
              <LedgerRow label="Wallet prompts" value="None" accent />
            </div>

            <div className="truth-card" id="privacy">
              <Sparkle size={18} weight="fill" />
              <div>
                <strong>Private identity, public market.</strong>
                <p>
                  Root-wallet identity is sanitized. Token metadata, account,
                  amounts, timing, prices, and transactions remain public; the
                  routing provider can link its two legs.
                </p>
              </div>
            </div>
          </aside>
        </section>

        <section className="privacy-strip" aria-label="Privacy guarantees">
          <div>
            <span>Hidden from Pons</span>
            <strong>Your connected or Starknet root wallet</strong>
          </div>
          <div>
            <span>Always public</span>
            <strong>Token, account, amounts, prices, timing</strong>
          </div>
          <div>
            <span>Project-held</span>
            <strong>Signer, viewing key, proof orchestration</strong>
          </div>
        </section>
      </main>

      <footer>
        <span>Pons Privacy / prototype 0.1</span>
        <p>Root-wallet unlinkability—not confidential Robinhood execution.</p>
        <a
          href="https://docs.ponsfamily.com/v2"
          target="_blank"
          rel="noreferrer"
        >
          Pons V2 docs <ArrowRight size={12} />
        </a>
      </footer>

      {preview ? (
        <ReviewDialog
          draft={{ ...draft, symbol }}
          preview={preview}
          acknowledged={acknowledged}
          launchEnabled={launchEnabled}
          busy={busy === "submit"}
          onAcknowledge={setAcknowledged}
          onClose={closeReview}
          onSubmit={submit}
        />
      ) : null}

      {submission ? (
        <div className="modal-backdrop" role="presentation">
          <section
            className="success-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="success-title"
          >
            <div className="success-icon">
              <CheckCircle size={35} weight="fill" />
            </div>
            <p className="section-number">Request accepted</p>
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

function Field({
  id,
  label,
  hint,
  error,
  icon,
  children,
}: {
  id: string;
  label: string;
  hint: string;
  error?: string | undefined;
  icon?: ReactNode | undefined;
  children: ReactNode;
}) {
  return (
    <label className="field" htmlFor={id} data-invalid={Boolean(error)}>
      <span className="field-meta">
        <span>
          {icon}
          {label}
        </span>
        <small>{error ?? hint}</small>
      </span>
      {children}
    </label>
  );
}

function RouteStep({
  index,
  title,
  description,
  active,
}: {
  index: string;
  title: string;
  description: string;
  active: boolean;
}) {
  return (
    <li data-active={active}>
      <span className="step-index">
        {active ? <Check size={12} weight="bold" /> : index}
      </span>
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
    </li>
  );
}

function LedgerRow({
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
      <span>{label}</span>
      <strong>{value}</strong>
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
            <p className="section-number">Final review</p>
            <h2 id="review-title">This becomes public and irreversible.</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close launch review"
          >
            <X size={19} />
          </button>
        </header>

        <div className="review-token">
          <span>{draft.symbol.slice(0, 2) || "P?"}</span>
          <div>
            <small>Token identity</small>
            <strong>{draft.name}</strong>
            <p>${draft.symbol}</p>
          </div>
        </div>

        <div className="review-ledger">
          <LedgerRow
            label="Network"
            value={`${preview.chainName} · ${preview.chainId}`}
          />
          <LedgerRow label="Pair asset" value="USDG" />
          <LedgerRow
            label="Launch fee"
            value={`${preview.launchFeeEth} ETH · sponsored`}
          />
          <LedgerRow
            label="Creator tax"
            value={`${(draft.creatorTaxBps / 100).toFixed(2)}%`}
          />
          <LedgerRow
            label="Buyback vault"
            value={draft.buybackEnabled ? "Enabled" : "Disabled"}
          />
          <LedgerRow
            label="Execution account"
            value={shorten(preview.privacyAccount, 8, 6)}
            accent
          />
        </div>

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
              <strong>Public:</strong> this metadata, execution account,
              transaction, amounts, and timing remain observable.
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
            I reviewed the token name, symbol, economics, and public privacy
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

function shorten(value: string, head = 6, tail = 4): string {
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function message(cause: unknown): string {
  return cause instanceof Error
    ? cause.message
    : "The launch service could not prepare this request";
}
