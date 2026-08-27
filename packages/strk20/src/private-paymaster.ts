import { hash, type Call } from "starknet";

export interface PrivatePaymasterFeeAction {
  readonly type: "withdraw";
  readonly recipient: string;
  readonly token: string;
  readonly amount: bigint;
}

export interface PrivatePaymasterBuild {
  readonly parameters: {
    readonly version: "0x1";
    readonly fee_mode: {
      readonly mode: "sponsored_private";
      readonly pool_fee_token: string;
    };
  };
  readonly feeAction?: PrivatePaymasterFeeAction;
}

export interface PrivatePaymasterExecution {
  readonly transactionHash: string;
  readonly trackingId: string;
}

export interface PrivatePaymasterGateway {
  buildPoolAction(
    poolAddress: string,
    feeToken: string,
  ): Promise<PrivatePaymasterBuild>;
  executePoolAction(args: {
    poolAddress: string;
    call: Call;
    proof: string;
    proofFacts: readonly string[];
    build: PrivatePaymasterBuild;
  }): Promise<PrivatePaymasterExecution>;
}

export class AvnuPrivatePaymasterGateway implements PrivatePaymasterGateway {
  constructor(
    private readonly endpoint: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    if (!endpoint.startsWith("/") && !endpoint.startsWith("https://")) {
      throw new Error("private paymaster endpoint must be relative or HTTPS");
    }
  }

  async buildPoolAction(
    poolAddress: string,
    feeToken: string,
  ): Promise<PrivatePaymasterBuild> {
    const parameters = {
      version: "0x1" as const,
      fee_mode: {
        mode: "sponsored_private" as const,
        pool_fee_token: feeToken,
      },
    };
    const result = await this.rpc("paymaster_buildTransaction", {
      transaction: {
        type: "apply_action",
        apply_action: { pool_address: poolAddress },
      },
      parameters,
    });
    const fee = result.fee_action;
    let feeAction: PrivatePaymasterFeeAction | undefined;
    if (fee !== undefined && fee !== null) {
      const value = record(fee, "fee_action");
      if (value.type !== "withdraw") {
        throw new Error("fee_action.type must be withdraw");
      }
      const recipient = felt(value.recipient, "fee_action.recipient");
      const amount = unsigned(value.amount, "fee_action.amount");
      if (amount > 0n && BigInt(recipient) === 0n) {
        throw new Error("fee_action.recipient must not be zero");
      }
      feeAction = {
        type: "withdraw",
        recipient,
        token: felt(value.token, "fee_action.token"),
        amount,
      };
    }
    return { parameters, ...(feeAction ? { feeAction } : {}) };
  }

  async executePoolAction(args: {
    poolAddress: string;
    call: Call;
    proof: string;
    proofFacts: readonly string[];
    build: PrivatePaymasterBuild;
  }): Promise<PrivatePaymasterExecution> {
    const result = await this.rpc("paymaster_executeTransaction", {
      transaction: {
        type: "apply_action",
        apply_action: {
          pool_address: args.poolAddress,
          apply_actions_call: toAvnuCall(args.call),
          proof: felt(args.proof, "proof"),
          proof_facts: args.proofFacts.map((value, index) =>
            felt(value, `proof_facts[${index}]`),
          ),
        },
      },
      parameters: args.build.parameters,
    });
    return {
      transactionHash: felt(result.transaction_hash, "transaction_hash"),
      trackingId: string(result.tracking_id, "tracking_id"),
    };
  }

  private async rpc(
    method: "paymaster_buildTransaction" | "paymaster_executeTransaction",
    params: unknown,
  ): Promise<Record<string, unknown>> {
    const response = await this.fetchImpl(this.endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(30_000),
    });
    const body = record(await response.json(), "paymaster response");
    if (!response.ok || body.error) {
      const error = body.error
        ? record(body.error, "paymaster error")
        : undefined;
      throw new Error(
        typeof error?.message === "string"
          ? error.message
          : `private paymaster returned HTTP ${response.status}`,
      );
    }
    return record(body.result, "paymaster result");
  }
}

function toAvnuCall(call: Call): {
  to: string;
  selector: string;
  calldata: string[];
} {
  const calldata = Array.isArray(call.calldata)
    ? call.calldata.map((value) => felt(value, "call.calldata"))
    : [];
  return {
    to: felt(call.contractAddress, "call.contractAddress"),
    selector: call.entrypoint.startsWith("0x")
      ? felt(call.entrypoint, "call.entrypoint")
      : hash.getSelectorFromName(call.entrypoint),
    calldata,
  };
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, field: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value;
}

function felt(value: unknown, field: string): string {
  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "bigint"
  ) {
    throw new Error(`${field} must be a felt`);
  }
  try {
    const parsed = BigInt(value);
    if (parsed < 0n || parsed >= 2n ** 251n) throw new Error();
    return `0x${parsed.toString(16)}`;
  } catch {
    throw new Error(`${field} must be a felt`);
  }
}

function unsigned(value: unknown, field: string): bigint {
  try {
    const parsed = BigInt(value as string | number | bigint);
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${field} must be an unsigned integer`);
  }
}
