import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface StoredTradePreview {
  readonly previewId: string;
  readonly side: "buy" | "sell";
  readonly account: string;
  readonly owner: string;
  readonly accountIndex: number;
  readonly token: string;
  readonly curve: string;
  readonly amountIn: string;
  readonly minimumAmountOut: string;
  readonly slippageBps: number;
  readonly expiresAt: number;
  readonly createdAt: number;
}

export interface StoredTradeSubmission {
  readonly idempotencyKey: string;
  readonly previewId: string;
  readonly requestHash: string;
  readonly state: "pending" | "submitted";
  readonly requestId: string;
  readonly transactionHash?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface TradeApplicationStore {
  putPreview(preview: StoredTradePreview): Promise<void>;
  getPreview(previewId: string): Promise<StoredTradePreview | undefined>;
  reserveSubmission(submission: StoredTradeSubmission): Promise<{
    readonly record: StoredTradeSubmission;
    readonly created: boolean;
  }>;
  completeSubmission(
    idempotencyKey: string,
    transactionHash: string,
    updatedAt: number,
  ): Promise<StoredTradeSubmission>;
  releaseSubmission(idempotencyKey: string, requestHash: string): Promise<void>;
}

interface StoreDocument {
  readonly version: 1;
  readonly previews: readonly StoredTradePreview[];
  readonly submissions: readonly StoredTradeSubmission[];
}

export class MemoryTradeApplicationStore implements TradeApplicationStore {
  private readonly previews = new Map<string, StoredTradePreview>();
  private readonly submissions = new Map<string, StoredTradeSubmission>();

  async putPreview(preview: StoredTradePreview): Promise<void> {
    this.previews.set(preview.previewId, preview);
  }

  async getPreview(previewId: string) {
    return this.previews.get(previewId);
  }

  async reserveSubmission(submission: StoredTradeSubmission) {
    const existing = this.submissions.get(submission.idempotencyKey);
    if (existing) {
      assertSameSubmission(existing, submission);
      return { record: existing, created: false } as const;
    }
    this.submissions.set(submission.idempotencyKey, submission);
    return { record: submission, created: true } as const;
  }

  async completeSubmission(
    idempotencyKey: string,
    transactionHash: string,
    updatedAt: number,
  ) {
    const current = this.submissions.get(idempotencyKey);
    if (!current) throw new Error("trade submission was not reserved");
    const completed = {
      ...current,
      state: "submitted" as const,
      transactionHash,
      updatedAt,
    };
    this.submissions.set(idempotencyKey, completed);
    return completed;
  }

  async releaseSubmission(
    idempotencyKey: string,
    requestHash: string,
  ): Promise<void> {
    const current = this.submissions.get(idempotencyKey);
    if (current?.state === "pending" && current.requestHash === requestHash) {
      this.submissions.delete(idempotencyKey);
    }
  }
}

export class FileTradeApplicationStore implements TradeApplicationStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {
    if (!path.trim())
      throw new Error("trade application store path is required");
  }

  putPreview(preview: StoredTradePreview): Promise<void> {
    return this.exclusive(async () => {
      const document = await this.read();
      await this.write({
        ...document,
        previews: [
          ...document.previews.filter(
            (candidate) => candidate.previewId !== preview.previewId,
          ),
          preview,
        ],
      });
    });
  }

  getPreview(previewId: string) {
    return this.exclusive(async () =>
      (await this.read()).previews.find(
        (candidate) => candidate.previewId === previewId,
      ),
    );
  }

  reserveSubmission(submission: StoredTradeSubmission) {
    return this.exclusive(async () => {
      const document = await this.read();
      const existing = document.submissions.find(
        (candidate) => candidate.idempotencyKey === submission.idempotencyKey,
      );
      if (existing) {
        assertSameSubmission(existing, submission);
        return { record: existing, created: false } as const;
      }
      await this.write({
        ...document,
        submissions: [...document.submissions, submission],
      });
      return { record: submission, created: true } as const;
    });
  }

  completeSubmission(
    idempotencyKey: string,
    transactionHash: string,
    updatedAt: number,
  ) {
    return this.exclusive(async () => {
      const document = await this.read();
      const current = document.submissions.find(
        (candidate) => candidate.idempotencyKey === idempotencyKey,
      );
      if (!current) throw new Error("trade submission was not reserved");
      const completed = {
        ...current,
        state: "submitted" as const,
        transactionHash,
        updatedAt,
      };
      await this.write({
        ...document,
        submissions: document.submissions.map((candidate) =>
          candidate.idempotencyKey === idempotencyKey ? completed : candidate,
        ),
      });
      return completed;
    });
  }

  releaseSubmission(idempotencyKey: string, requestHash: string) {
    return this.exclusive(async () => {
      const document = await this.read();
      await this.write({
        ...document,
        submissions: document.submissions.filter(
          (candidate) =>
            candidate.idempotencyKey !== idempotencyKey ||
            candidate.requestHash !== requestHash ||
            candidate.state !== "pending",
        ),
      });
    });
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = this.queue.then(work, work);
    this.queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async read(): Promise<StoreDocument> {
    try {
      const value = JSON.parse(
        await readFile(this.path, "utf8"),
      ) as Partial<StoreDocument>;
      if (
        value.version !== 1 ||
        !Array.isArray(value.previews) ||
        !Array.isArray(value.submissions)
      ) {
        throw new Error("trade application store is invalid");
      }
      return value as StoreDocument;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, previews: [], submissions: [] };
      }
      throw error;
    }
  }

  private async write(document: StoreDocument): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(document), {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, this.path);
  }
}

function assertSameSubmission(
  existing: StoredTradeSubmission,
  requested: StoredTradeSubmission,
): void {
  if (
    existing.previewId !== requested.previewId ||
    existing.requestHash !== requested.requestHash
  ) {
    throw new Error("idempotency key is already bound to another trade");
  }
}
