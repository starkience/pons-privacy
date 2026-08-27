import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileLaunchApplicationStore } from "./launch-application-store.js";

const directories: string[] = [];
const preview = {
  previewId: "16692477-6f05-4d6e-aa30-4b2dd753c63d",
  draftHash: `0x${"11".repeat(32)}`,
  account: "0x2222222222222222222222222222222222222222",
  owner: "0x3333333333333333333333333333333333333333",
  accountIndex: 7,
  expiresAt: 2_000,
  createdAt: 1_000,
};
const submission = {
  idempotencyKey: preview.previewId,
  previewId: preview.previewId,
  requestHash: `0x${"44".repeat(32)}`,
  state: "pending" as const,
  requestId: "26692477-6f05-4d6e-aa30-4b2dd753c63d",
  createdAt: 1_000,
  updatedAt: 1_000,
};

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

describe("durable launch application store", () => {
  it("survives a restart without submitting the same request twice", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pons-launch-store-"));
    directories.push(directory);
    const path = join(directory, "operations.json");
    const first = new FileLaunchApplicationStore(path);
    await first.putPreview(preview);
    await first.reserveSubmission(submission);
    await first.completeSubmission(
      submission.idempotencyKey,
      `0x${"55".repeat(32)}`,
      1_100,
    );

    const reopened = new FileLaunchApplicationStore(path);
    await expect(reopened.getPreview(preview.previewId)).resolves.toEqual(
      preview,
    );
    await expect(reopened.reserveSubmission(submission)).resolves.toMatchObject(
      {
        created: false,
        record: { state: "submitted", transactionHash: `0x${"55".repeat(32)}` },
      },
    );
  });

  it("does not bind one idempotency key to different signed calldata", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pons-launch-store-"));
    directories.push(directory);
    const store = new FileLaunchApplicationStore(
      join(directory, "operations.json"),
    );
    await store.reserveSubmission(submission);
    await expect(
      store.reserveSubmission({
        ...submission,
        requestHash: `0x${"66".repeat(32)}`,
      }),
    ).rejects.toThrow(/another launch/);
  });
});
