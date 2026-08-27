import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type SwapOperationDirection = "deposit" | "funding";

export interface SwapOperationInput {
  readonly operationId: string;
  readonly direction: SwapOperationDirection;
  readonly amount: string;
  readonly sourceAddress: string;
  readonly destinationAddress: string;
}

export interface SwapOperationRecord extends SwapOperationInput {
  readonly state: "creating" | "created";
  readonly swapId?: string;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface SwapOperationStore {
  begin(input: SwapOperationInput): Promise<{
    readonly record: SwapOperationRecord;
    readonly created: boolean;
  }>;
  resolve(operationId: string, swapId: string): Promise<SwapOperationRecord>;
}

interface StoreDocument {
  readonly version: 1;
  readonly operations: readonly SwapOperationRecord[];
}

export class MemorySwapOperationStore implements SwapOperationStore {
  private readonly records = new Map<string, SwapOperationRecord>();

  constructor(private readonly now: () => number = Date.now) {}

  async begin(input: SwapOperationInput) {
    const existing = this.records.get(input.operationId);
    if (existing) {
      assertSameOperation(existing, input);
      return { record: existing, created: false } as const;
    }
    const timestamp = this.now();
    const record: SwapOperationRecord = {
      ...input,
      state: "creating",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.records.set(input.operationId, record);
    return { record, created: true } as const;
  }

  async resolve(operationId: string, swapId: string) {
    const current = this.records.get(operationId);
    if (!current) throw new Error("swap operation was not reserved");
    if (current.swapId && current.swapId !== swapId) {
      throw new Error("swap operation resolved to a different provider ID");
    }
    const record: SwapOperationRecord = {
      ...current,
      state: "created",
      swapId,
      updatedAt: this.now(),
    };
    this.records.set(operationId, record);
    return record;
  }
}

export class FileSwapOperationStore implements SwapOperationStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly path: string,
    private readonly now: () => number = Date.now,
  ) {
    if (!path.trim()) throw new Error("swap operation store path is required");
  }

  begin(input: SwapOperationInput) {
    return this.exclusive(async () => {
      const document = await this.read();
      const existing = document.operations.find(
        (record) => record.operationId === input.operationId,
      );
      if (existing) {
        assertSameOperation(existing, input);
        return { record: existing, created: false } as const;
      }
      const timestamp = this.now();
      const record: SwapOperationRecord = {
        ...input,
        state: "creating",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      await this.write({
        version: 1,
        operations: [...document.operations, record],
      });
      return { record, created: true } as const;
    });
  }

  resolve(operationId: string, swapId: string) {
    return this.exclusive(async () => {
      const document = await this.read();
      const current = document.operations.find(
        (record) => record.operationId === operationId,
      );
      if (!current) throw new Error("swap operation was not reserved");
      if (current.swapId && current.swapId !== swapId) {
        throw new Error("swap operation resolved to a different provider ID");
      }
      const record: SwapOperationRecord = {
        ...current,
        state: "created",
        swapId,
        updatedAt: this.now(),
      };
      await this.write({
        version: 1,
        operations: document.operations.map((candidate) =>
          candidate.operationId === operationId ? record : candidate,
        ),
      });
      return record;
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
        return { version: 1, operations: [] };
      }
      throw error;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("swap operation store is invalid");
    }
    const document = value as Partial<StoreDocument>;
    if (document.version !== 1 || !Array.isArray(document.operations)) {
      throw new Error("swap operation store is invalid");
    }
    return { version: 1, operations: document.operations };
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

function assertSameOperation(
  existing: SwapOperationRecord,
  input: SwapOperationInput,
): void {
  if (
    existing.direction !== input.direction ||
    existing.amount !== input.amount ||
    existing.sourceAddress.toLowerCase() !==
      input.sourceAddress.toLowerCase() ||
    existing.destinationAddress.toLowerCase() !==
      input.destinationAddress.toLowerCase()
  ) {
    throw new Error("operationId is already bound to a different route");
  }
}
