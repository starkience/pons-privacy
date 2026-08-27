import { getAddress, isAddress, isHex, type Address, type Hex } from "viem";
import type {
  ExecutionCall,
  RelayExecutionRequest,
  RelayerFee,
} from "@pons-privacy/sdk";

function record(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} must be an object`);
  }
  return value as Record<string, unknown>;
}

function address(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value, { strict: true })) {
    throw new Error(`${field} must be a 20-byte EVM address`);
  }
  return getAddress(value);
}

function hex(value: unknown, field: string): Hex {
  if (typeof value !== "string" || !isHex(value))
    throw new Error(`${field} must be hex`);
  return value;
}

function uint(value: unknown, field: string): bigint {
  if (typeof value !== "string" || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${field} must be an unsigned base-10 integer string`);
  }
  return BigInt(value);
}

function safeNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

export function parseRelayRequest(value: unknown): RelayExecutionRequest {
  const input = record(value, "request");
  if (!Array.isArray(input.calls)) throw new Error("calls must be an array");
  const calls: ExecutionCall[] = input.calls.map((raw, index) => {
    const call = record(raw, `calls[${index}]`);
    return {
      target: address(call.target, `calls[${index}].target`),
      value: uint(call.value, `calls[${index}].value`),
      data: hex(call.data, `calls[${index}].data`),
    };
  });
  const rawFee = record(input.fee, "fee");
  const fee: RelayerFee = {
    token: address(rawFee.token, "fee.token"),
    amount: uint(rawFee.amount, "fee.amount"),
    recipient: address(rawFee.recipient, "fee.recipient"),
  };
  const policyContext =
    input.policyContext === undefined
      ? undefined
      : parsePolicyContext(input.policyContext);
  return {
    chainId: safeNumber(input.chainId, "chainId"),
    factory: address(input.factory, "factory"),
    account: address(input.account, "account"),
    owner: address(input.owner, "owner"),
    accountIndex: safeNumber(input.accountIndex, "accountIndex"),
    calls,
    nonce: uint(input.nonce, "nonce"),
    deadline: uint(input.deadline, "deadline"),
    prefund: uint(input.prefund, "prefund"),
    fee,
    signature: hex(input.signature, "signature"),
    ...(policyContext ? { policyContext } : {}),
  };
}

function parsePolicyContext(value: unknown) {
  const input = record(value, "policyContext");
  if (input.kind !== "layerswap-return") {
    throw new Error("policyContext.kind is not supported");
  }
  if (
    typeof input.swapId !== "string" ||
    !input.swapId.trim() ||
    input.swapId.length > 128
  ) {
    throw new Error("policyContext.swapId must be a bounded identifier");
  }
  return { kind: "layerswap-return" as const, swapId: input.swapId };
}
