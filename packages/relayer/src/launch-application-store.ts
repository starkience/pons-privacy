import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export interface StoredLaunchPreview {
  readonly previewId: string;
  readonly draftHash: string;
  readonly account: string;
  readonly owner: string;
  readonly accountIndex: number;
  readonly expiresAt: number;
  readonly createdAt: number;
}

export interface StoredLaunchSubmission {
  readonly idempotencyKey: string;
  readonly previewId: string;
  readonly requestHash: string;
  readonly state: "pending" | "submitted";
  readonly requestId: string;
  readonly transactionHash?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface LaunchApplicationStore {
  putPreview(preview: StoredLaunchPreview): Promise<void>;
  getPreview(previewId: string): Promise<StoredLaunchPreview | undefined>;
  reserveSubmission(submission: StoredLaunchSubmission): Promise<{
    readonly record: StoredLaunchSubmission;
    readonly created: boolean;
  }>;
  completeSubmission(
    idempotencyKey: string,
    transactionHash: string,
    updatedAt: number,
  ): Promise<StoredLaunchSubmission>;
  releaseSubmission(idempotencyKey: string, requestHash: string): Promise<void>;
}

interface StoreDocument {
  readonly version: 1;
  readonly previews: readonly StoredLaunchPreview[];
  readonly submissions: readonly StoredLaunchSubmission[];
}

export class MemoryLaunchApplicationStore implements LaunchApplicationStore {
  private readonly previews = new Map<string, StoredLaunchPreview>();
  private readonly submissions = new Map<string, StoredLaunchSubmission>();

  async putPreview(preview: StoredLaunchPreview): Promise<void> {
    this.previews.set(preview.previewId, preview);
  }

  async getPreview(previewId: string) {
    return this.previews.get(previewId);
  }

  async reserveSubmission(submission: StoredLaunchSubmission) {
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
    if (!current) throw new Error("launch submission was not reserved");
    const completed: StoredLaunchSubmission = {
      ...current,
      state: "submitted",
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

export class FileLaunchApplicationStore implements LaunchApplicationStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {
    if (!path.trim())
      throw new Error("launch application store path is required");
  }

  putPreview(preview: StoredLaunchPreview): Promise<void> {
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

  reserveSubmission(submission: StoredLaunchSubmission) {
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
      if (!current) throw new Error("launch submission was not reserved");
      const completed: StoredLaunchSubmission = {
        ...current,
        state: "submitted",
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
    let value: unknown;
    try {
      value = JSON.parse(await readFile(this.path, "utf8")) as unknown;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { version: 1, previews: [], submissions: [] };
      }
      throw error;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("launch application store is invalid");
    }
    const document = value as Partial<StoreDocument>;
    if (
      document.version !== 1 ||
      !Array.isArray(document.previews) ||
      !Array.isArray(document.submissions)
    ) {
      throw new Error("launch application store is invalid");
    }
    return {
      version: 1,
      previews: document.previews,
      submissions: document.submissions,
    };
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
  existing: StoredLaunchSubmission,
  requested: StoredLaunchSubmission,
): void {
  if (
    existing.previewId !== requested.previewId ||
    existing.requestHash !== requested.requestHash
  ) {
    throw new Error("idempotency key is already bound to another launch");
  }
}
