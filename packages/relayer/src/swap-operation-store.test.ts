import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileSwapOperationStore } from "./swap-operation-store.js";

const operation = {
  operationId: "16692477-6f05-4d6e-aa30-4b2dd753c63d",
  direction: "funding" as const,
  amount: "10000000",
  sourceAddress: "0x123",
  destinationAddress: "0x2222222222222222222222222222222222222222",
};
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, {
        recursive: true,
        force: true,
      }),
    ),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "pons-swap-store-"));
  directories.push(directory);
  return directory;
}

describe("durable LayerSwap operation store", () => {
  it("survives a restart and preserves the provider swap ID", async () => {
    const directory = await temporaryDirectory();
    const path = join(directory, "operations.json");
    const first = new FileSwapOperationStore(path, () => 100);
    await expect(first.begin(operation)).resolves.toMatchObject({
      created: true,
      record: { state: "creating" },
    });
    await first.resolve(operation.operationId, operation.operationId);

    const reopened = new FileSwapOperationStore(path, () => 200);
    await expect(reopened.begin(operation)).resolves.toMatchObject({
      created: false,
      record: { state: "created", swapId: operation.operationId },
    });
    expect(await readFile(path, "utf8")).toContain('"version":1');
  });

  it("will not reuse an operation ID for a different destination", async () => {
    const directory = await temporaryDirectory();
    const store = new FileSwapOperationStore(
      join(directory, "operations.json"),
    );
    await store.begin(operation);
    await expect(
      store.begin({
        ...operation,
        destinationAddress: "0x3333333333333333333333333333333333333333",
      }),
    ).rejects.toThrow(/different route/);
  });
});
