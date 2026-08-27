import { hash, stark, type Account, type Call, type TypedData } from "starknet";

export interface PrivatePaymasterCall {
  readonly to: string;
  readonly selector: string;
  readonly calldata: readonly string[];
}

export interface PrivatePaymasterFeeAction {
  readonly type: "withdraw";
  readonly recipient: string;
  readonly token: string;
  readonly amount: bigint;
}

export interface PrivatePaymasterBuild {
  readonly type?: "apply_action" | "invoke_and_apply_action";
  readonly parameters: {
    readonly version: "0x1";
    readonly fee_mode: {
      readonly mode: "sponsored_private";
      readonly pool_fee_token: string;
    };
  };
  readonly feeAction?: PrivatePaymasterFeeAction;
  readonly typedData?: TypedData;
  readonly userAddress?: string;
  readonly userCalls?: readonly PrivatePaymasterCall[];
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
  buildInvokeAndPoolAction(
    poolAddress: string,
    feeToken: string,
    userAddress: string,
    userCalls: readonly Call[],
  ): Promise<PrivatePaymasterBuild>;
  executePoolAction(args: {
    poolAddress: string;
    call: Call;
    proof: string;
    proofFacts: readonly string[];
    build: PrivatePaymasterBuild;
    onRelayStart?: () => void | Promise<void>;
  }): Promise<PrivatePaymasterExecution>;
  executeInvokeAndPoolAction(args: {
    poolAddress: string;
    call: Call;
    proof: string;
    proofFacts: readonly string[];
    build: PrivatePaymasterBuild;
    account: Pick<Account, "signMessage">;
    onRelayStart?: () => void | Promise<void>;
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
    const parameters = privateParameters(feeToken);
    const result = await this.rpc("paymaster_buildTransaction", {
      transaction: {
        type: "apply_action",
        apply_action: { pool_address: felt(poolAddress, "poolAddress") },
      },
      parameters,
    });
    const feeAction = parseFeeAction(result.fee_action);
    return {
      type: "apply_action",
      parameters,
      ...(feeAction ? { feeAction } : {}),
    };
  }

  async buildInvokeAndPoolAction(
    poolAddress: string,
    feeToken: string,
    userAddress: string,
    userCalls: readonly Call[],
  ): Promise<PrivatePaymasterBuild> {
    const parameters = privateParameters(feeToken);
    const calls = userCalls.map(toAvnuCall);
    const result = await this.rpc("paymaster_buildTransaction", {
      transaction: {
        type: "invoke_and_apply_action",
        apply_action: { pool_address: felt(poolAddress, "poolAddress") },
        invoke: { user_address: felt(userAddress, "userAddress"), calls },
      },
      parameters,
    });
    const typedData = typedDataValue(result.typed_data, "typed_data");
    const feeAction = parseFeeAction(result.fee_action);
    return {
      type: "invoke_and_apply_action",
      parameters,
      typedData,
      userAddress: felt(userAddress, "userAddress"),
      userCalls: calls,
      ...(feeAction ? { feeAction } : {}),
    };
  }

  async executePoolAction(args: {
    poolAddress: string;
    call: Call;
    proof: string;
    proofFacts: readonly string[];
    build: PrivatePaymasterBuild;
    onRelayStart?: () => void | Promise<void>;
  }): Promise<PrivatePaymasterExecution> {
    await args.onRelayStart?.();
    const result = await this.rpc("paymaster_executeTransaction", {
      transaction: {
        type: "apply_action",
        apply_action: executableApplyAction(args),
      },
      parameters: args.build.parameters,
    });
    return execution(result);
  }

  async executeInvokeAndPoolAction(args: {
    poolAddress: string;
    call: Call;
    proof: string;
    proofFacts: readonly string[];
    build: PrivatePaymasterBuild;
    account: Pick<Account, "signMessage">;
    onRelayStart?: () => void | Promise<void>;
  }): Promise<PrivatePaymasterExecution> {
    const { build } = args;
    if (
      build.type !== "invoke_and_apply_action" ||
      !build.typedData ||
      !build.userAddress ||
      !build.userCalls
    ) {
      throw new Error("private paymaster invoke build context is incomplete");
    }
    const typedCalls = extractTypedDataCalls(build.typedData);
    if (!typedCalls || !callsEqual(build.userCalls, typedCalls)) {
      throw new Error(
        "private paymaster typed-data calls changed; refusing to sign",
      );
    }
    const signature = stark.formatSignature(
      await args.account.signMessage(build.typedData),
    );
    await args.onRelayStart?.();
    const result = await this.rpc("paymaster_executeTransaction", {
      transaction: {
        type: "invoke_and_apply_action",
        invoke: {
          user_address: build.userAddress,
          typed_data: build.typedData,
          signature,
        },
        apply_action: executableApplyAction(args),
      },
      parameters: build.parameters,
    });
    return execution(result);
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

function privateParameters(
  feeToken: string,
): PrivatePaymasterBuild["parameters"] {
  return {
    version: "0x1",
    fee_mode: {
      mode: "sponsored_private",
      pool_fee_token: felt(feeToken, "feeToken"),
    },
  };
}

function parseFeeAction(value: unknown): PrivatePaymasterFeeAction | undefined {
  if (value === undefined || value === null) return undefined;
  const fee = record(value, "fee_action");
  if (fee.type !== "withdraw") {
    throw new Error("fee_action.type must be withdraw");
  }
  const recipient = felt(fee.recipient, "fee_action.recipient");
  const amount = unsigned(fee.amount, "fee_action.amount");
  if (amount > 0n && BigInt(recipient) === 0n) {
    throw new Error("fee_action.recipient must not be zero");
  }
  return {
    type: "withdraw",
    recipient,
    token: felt(fee.token, "fee_action.token"),
    amount,
  };
}

function executableApplyAction(args: {
  poolAddress: string;
  call: Call;
  proof: string;
  proofFacts: readonly string[];
}) {
  return {
    pool_address: felt(args.poolAddress, "poolAddress"),
    apply_actions_call: toAvnuCall(args.call),
    proof: felt(args.proof, "proof"),
    proof_facts: args.proofFacts.map((value, index) =>
      felt(value, `proof_facts[${index}]`),
    ),
  };
}

function execution(result: Record<string, unknown>): PrivatePaymasterExecution {
  return {
    transactionHash: felt(result.transaction_hash, "transaction_hash"),
    trackingId: string(result.tracking_id, "tracking_id"),
  };
}

function typedDataValue(value: unknown, field: string): TypedData {
  const typedData = record(value, field);
  if (
    !typedData.types ||
    typeof typedData.types !== "object" ||
    Array.isArray(typedData.types)
  ) {
    throw new Error(`${field}.types must be an object`);
  }
  if (!typedData.message || typeof typedData.message !== "object") {
    throw new Error(`${field}.message must be an object`);
  }
  return typedData as unknown as TypedData;
}

function extractTypedDataCalls(
  typedData: TypedData,
): readonly PrivatePaymasterCall[] | undefined {
  const message = typedData.message as Record<string, unknown>;
  const raw = message.Calls ?? message.calls;
  if (!Array.isArray(raw)) return undefined;
  const calls: PrivatePaymasterCall[] = [];
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate))
      return undefined;
    const value = candidate as Record<string, unknown>;
    const to = value.To ?? value.to;
    const selector = value.Selector ?? value.selector;
    const calldata = value.Calldata ?? value.calldata;
    if (!Array.isArray(calldata)) return undefined;
    try {
      calls.push({
        to: felt(to, "typed_data.call.to"),
        selector: felt(selector, "typed_data.call.selector"),
        calldata: calldata.map((item) =>
          felt(item, "typed_data.call.calldata"),
        ),
      });
    } catch {
      return undefined;
    }
  }
  return calls;
}

function callsEqual(
  expected: readonly PrivatePaymasterCall[],
  actual: readonly PrivatePaymasterCall[],
): boolean {
  return (
    expected.length === actual.length &&
    expected.every((call, index) => {
      const candidate = actual[index];
      return (
        candidate !== undefined &&
        BigInt(call.to) === BigInt(candidate.to) &&
        BigInt(call.selector) === BigInt(candidate.selector) &&
        call.calldata.length === candidate.calldata.length &&
        call.calldata.every(
          (item, itemIndex) =>
            BigInt(item) === BigInt(candidate.calldata[itemIndex]!),
        )
      );
    })
  );
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
