import { encodeFunctionData, type Address } from "viem";
import { erc20Abi } from "./abi.js";
import type { ExecutionCall } from "./types.js";

export function approveCall(
  token: Address,
  spender: Address,
  amount: bigint,
): ExecutionCall {
  return {
    target: token,
    value: 0n,
    data: encodeFunctionData({
      abi: erc20Abi,
      functionName: "approve",
      args: [spender, amount],
    }),
  };
}
