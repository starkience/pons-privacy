export const ponsPrivacyAccountAbi = [
  {
    type: "function",
    name: "nonce",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const ponsPrivacyAccountFactoryAbi = [
  {
    type: "event",
    name: "AccountCreated",
    anonymous: false,
    inputs: [
      { name: "account", type: "address", indexed: true },
      { name: "owner", type: "address", indexed: true },
      { name: "index", type: "uint256", indexed: true },
    ],
  },
  {
    type: "function",
    name: "computeAddress",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
    ],
    outputs: [{ name: "predicted", type: "address" }],
  },
  {
    type: "function",
    name: "deployAndExecute",
    stateMutability: "payable",
    inputs: [
      { name: "owner", type: "address" },
      { name: "index", type: "uint256" },
      {
        name: "calls",
        type: "tuple[]",
        components: [
          { name: "target", type: "address" },
          { name: "value", type: "uint256" },
          { name: "data", type: "bytes" },
        ],
      },
      { name: "executionNonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
      { name: "feeToken", type: "address" },
      { name: "feeAmount", type: "uint256" },
      { name: "feeRecipient", type: "address" },
      { name: "signature", type: "bytes" },
    ],
    outputs: [
      { name: "account", type: "address" },
      { name: "results", type: "bytes[]" },
    ],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;
