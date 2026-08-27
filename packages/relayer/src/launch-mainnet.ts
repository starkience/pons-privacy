import {
  createHttpRelay,
  NO_RELAYER_FEE,
  PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
  PONS_V2_ROBINHOOD,
  PonsPrivacyClient,
  ponsPrivacyAccountFactoryAbi,
  ponsV2Adapter,
  ponsV2FactoryAbi,
  robinhood,
  type ExecutionOwnerDeriver,
  type PonsV2LaunchIntent,
} from "@pons-privacy/sdk";
import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  type Log,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { launchMainnetConfig } from "./launch-mainnet-config.js";

const IDENTITY_MARKER = "project-held-mainnet-owner-v1";
const ACCOUNT_INDEX = 0;

const config = launchMainnetConfig(process.env);
const ownerAccount = privateKeyToAccount(config.ownerPrivateKey);
const publicClient = createPublicClient({
  chain: robinhood,
  transport: http(config.rpcUrl),
});
const ownerDeriver: ExecutionOwnerDeriver = {
  deriveEvmOwner(identitySignature, accountIndex, channel) {
    if (
      identitySignature !== IDENTITY_MARKER ||
      accountIndex !== ACCOUNT_INDEX ||
      channel !== "pons-privacy-v1"
    ) {
      throw new Error("unexpected project-held launch owner derivation input");
    }
    return {
      privateKey: config.ownerPrivateKey,
      address: ownerAccount.address,
    };
  },
};
const relay = createHttpRelay({
  endpoint: config.relayEndpoint,
  apiKey: config.relayerApiKey,
});
const client = new PonsPrivacyClient({
  chainId: robinhood.id,
  factory: PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD,
  publicClient,
  ownerDeriver,
  relay,
});
const session = await client.deriveSession(IDENTITY_MARKER, ACCOUNT_INDEX);
const intent: PonsV2LaunchIntent = {
  name: config.name,
  symbol: config.symbol,
  ...(config.logo === undefined ? {} : { logo: config.logo }),
  ...(config.description === undefined
    ? {}
    : { description: config.description }),
  socials: {
    ...(config.twitter === undefined ? {} : { twitter: config.twitter }),
    ...(config.telegram === undefined ? {} : { telegram: config.telegram }),
    ...(config.discord === undefined ? {} : { discord: config.discord }),
    ...(config.website === undefined ? {} : { website: config.website }),
    ...(config.farcaster === undefined ? {} : { farcaster: config.farcaster }),
  },
  creatorTaxBps: config.creatorTaxBps,
  buybackEnabled: config.buybackEnabled,
  launchConfigId: config.launchConfigId,
  salt: config.salt,
};
const calls = await ponsV2Adapter().buildLaunchCalls(intent, {
  account: session.account,
  publicClient,
});
const prefund = calls.reduce((total, call) => total + call.value, 0n);
const request = await client.prepareRelayRequest(
  IDENTITY_MARKER,
  session,
  calls,
  { prefund, fee: NO_RELAYER_FEE },
);

if (!config.broadcast) {
  console.info(
    JSON.stringify({
      mode: "dry-run",
      chainId: robinhood.id,
      owner: session.owner,
      privacyAccount: session.account,
      accountIndex: session.accountIndex,
      ponsFactory: PONS_V2_ROBINHOOD.factory,
      pairToken: PONS_V2_ROBINHOOD.usdg,
      prefundWei: prefund.toString(),
      nonce: request.nonce.toString(),
      deadline: request.deadline.toString(),
      callCount: calls.length,
      calldataBytes: calls.reduce(
        (size, call) => size + (call.data.length - 2) / 2,
        0,
      ),
      token: {
        name: intent.name,
        symbol: intent.symbol,
        logo: intent.logo ?? "",
        description: intent.description ?? "",
        socials: {
          twitter: intent.socials?.twitter ?? "",
          telegram: intent.socials?.telegram ?? "",
          discord: intent.socials?.discord ?? "",
          website: intent.socials?.website ?? "",
          farcaster: intent.socials?.farcaster ?? "",
        },
        creatorTaxBps: intent.creatorTaxBps,
        buybackEnabled: intent.buybackEnabled,
        launchConfigId: intent.launchConfigId?.toString(),
        salt: intent.salt,
      },
      broadcast: false,
    }),
  );
  process.exit(0);
}

const transactionHash = await relay(request);
console.info(
  JSON.stringify({
    event: "launch.broadcast",
    transactionHash,
    explorer: `https://robinhoodchain.blockscout.com/tx/${transactionHash}`,
    privacyAccount: session.account,
  }),
);
const receipt = await publicClient.waitForTransactionReceipt({
  hash: transactionHash,
  confirmations: 1,
  timeout: 120_000,
});
if (receipt.status !== "success") {
  throw new Error(`Pons launch transaction ${transactionHash} reverted`);
}
const launched = receipt.logs
  .filter((log) => getAddress(log.address) === PONS_V2_ROBINHOOD.factory)
  .map(decodeTokenLaunched)
  .find((event) => event !== undefined);
if (!launched) {
  throw new Error(
    `Pons launch transaction ${transactionHash} emitted no TokenLaunched event`,
  );
}
const accountCreated = receipt.logs.some((log) => {
  if (getAddress(log.address) !== PONS_PRIVACY_ACCOUNT_FACTORY_ROBINHOOD) {
    return false;
  }
  try {
    const event = decodeEventLog({ abi: ponsPrivacyAccountFactoryAbi, ...log });
    return event.eventName === "AccountCreated";
  } catch {
    return false;
  }
});
console.info(
  JSON.stringify({
    event: "launch.confirmed",
    transactionHash,
    blockNumber: receipt.blockNumber.toString(),
    gasUsed: receipt.gasUsed.toString(),
    privacyAccount: session.account,
    accountCreated,
    token: launched.token,
    curve: launched.curve,
    deployer: launched.deployer,
    pairToken: launched.pairToken,
    launchConfigId: launched.launchConfigId.toString(),
    explorer: `https://robinhoodchain.blockscout.com/tx/${transactionHash}`,
  }),
);

function decodeTokenLaunched(log: Log) {
  try {
    const event = decodeEventLog({ abi: ponsV2FactoryAbi, ...log });
    return event.eventName === "TokenLaunched" ? event.args : undefined;
  } catch {
    return undefined;
  }
}
