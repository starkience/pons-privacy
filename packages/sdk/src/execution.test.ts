import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";
import {
  executionTypedData,
  hashExecutionCalls,
  signExecution,
} from "./execution.js";
import { NO_RELAYER_FEE } from "./types.js";

const PRIVATE_KEY = `0x${"11".repeat(32)}` as Hex;
const ACCOUNT = "0x2222222222222222222222222222222222222222" as Address;

describe("Pons privacy execution authorization", () => {
  it("hashes a call batch deterministically", () => {
    const calls = [
      {
        target: "0x3333333333333333333333333333333333333333" as Address,
        value: 5n,
        data: "0x1234" as Hex,
      },
    ];
    expect(hashExecutionCalls(calls)).toMatch(/^0x[0-9a-f]{64}$/);
    expect(hashExecutionCalls(calls)).toBe(hashExecutionCalls([...calls]));
  });

  it("signs the PonsPrivacyAccount domain", async () => {
    const args = {
      chainId: 4663,
      account: ACCOUNT,
      calls: [] as const,
      nonce: 0n,
      deadline: 1_900_000_000n,
      fee: NO_RELAYER_FEE,
      prefund: 0n,
    };
    const signature = await signExecution({ ...args, privateKey: PRIVATE_KEY });
    const recovered = await recoverTypedDataAddress({
      ...executionTypedData(args),
      signature,
    });
    expect(recovered).toBe(privateKeyToAccount(PRIVATE_KEY).address);
    expect(executionTypedData(args).domain.name).toBe("PonsPrivacyAccount");
  });
});
