import type { DerivedPonsPrivacyIdentity } from "@pons-privacy/sdk";
import {
  Account,
  PaymasterRpc,
  RpcProvider,
  type PaymasterDetails,
} from "starknet";
import { requireStarknetAddress } from "./config.js";
import { isContractNotFoundError } from "./transport-account.js";

export interface RootAccountConfig {
  readonly rpcUrl: string;
  /** Same-origin proxy. The AVNU credential never enters the browser. */
  readonly paymasterUrl: string;
  readonly ozAccountClassHash: string;
}

export interface RootAccountDeploymentRequest {
  readonly previousTransactionHash?: string;
  readonly onTransactionHash?: (hash: string) => void | Promise<void>;
}

export interface RootAccountDeploymentResult {
  readonly deployed: boolean;
  readonly transactionHash?: string;
  readonly blockNumber?: number;
}

interface DeploymentProvider {
  getClassHashAt(address: string, blockIdentifier: "latest"): Promise<string>;
  waitForTransaction(transactionHash: string): Promise<{
    isSuccess(): boolean;
    readonly block_number?: number;
  }>;
}

interface DeploymentAccount {
  readonly address: string;
  executePaymasterTransaction(
    calls: [],
    details: PaymasterDetails,
  ): Promise<{ readonly transaction_hash: string }>;
}

/**
 * Deploys deterministic S1 through AVNU without STRK or a Starknet wallet. A
 * journaled hash is always reconciled before a new deploy can be attempted.
 */
export class RootAccountDeployer {
  constructor(
    private readonly provider: DeploymentProvider,
    private readonly account: DeploymentAccount,
    private readonly identity: DerivedPonsPrivacyIdentity,
    private readonly ozAccountClassHash: string,
  ) {}

  async ensureDeployed(
    request: RootAccountDeploymentRequest = {},
  ): Promise<RootAccountDeploymentResult> {
    if (await this.isExpectedAccountDeployed()) return { deployed: false };

    if (request.previousTransactionHash) {
      const recovered = await this.waitForDeployment(
        request.previousTransactionHash,
      );
      if (recovered) return recovered;
    }

    const details: PaymasterDetails = {
      feeMode: { mode: "sponsored" },
      deploymentData: {
        address: this.account.address,
        class_hash: this.ozAccountClassHash,
        salt: this.identity.starknetPublicKey,
        calldata: [this.identity.starknetPublicKey],
        version: 1,
      },
    };
    const submitted = await this.account.executePaymasterTransaction(
      [],
      details,
    );
    await request.onTransactionHash?.(submitted.transaction_hash);
    const result = await this.waitForDeployment(submitted.transaction_hash);
    if (!result) {
      throw new Error(`S1 deployment reverted: ${submitted.transaction_hash}`);
    }
    return result;
  }

  private async isExpectedAccountDeployed(): Promise<boolean> {
    try {
      const classHash = await this.provider.getClassHashAt(
        this.account.address,
        "latest",
      );
      if (BigInt(classHash) !== BigInt(this.ozAccountClassHash)) {
        throw new Error("S1 is deployed with an unexpected account class");
      }
      return true;
    } catch (error) {
      if (isContractNotFoundError(error)) return false;
      throw error;
    }
  }

  private async waitForDeployment(
    transactionHash: string,
  ): Promise<RootAccountDeploymentResult | undefined> {
    const receipt = await this.provider.waitForTransaction(transactionHash);
    if (!receipt.isSuccess()) return undefined;
    if (receipt.block_number === undefined) {
      throw new Error("S1 deployment receipt has no block number");
    }
    if (!(await this.isExpectedAccountDeployed())) {
      throw new Error("S1 deployment succeeded but its class is unavailable");
    }
    return {
      deployed: true,
      transactionHash,
      blockNumber: receipt.block_number,
    };
  }
}

export function createRootAccountDeployer(
  config: RootAccountConfig,
  identity: DerivedPonsPrivacyIdentity,
): RootAccountDeployer {
  const provider = new RpcProvider({ nodeUrl: config.rpcUrl });
  const paymaster = new PaymasterRpc({ nodeUrl: config.paymasterUrl });
  const account = new Account({
    provider,
    paymaster,
    address: requireStarknetAddress(
      identity.starknetAddress,
      "rootStarknetAddress",
    ),
    signer: identity.starknetPrivateKey,
    cairoVersion: "1",
  });
  return new RootAccountDeployer(
    provider,
    account,
    identity,
    requireStarknetAddress(config.ozAccountClassHash, "ozAccountClassHash"),
  );
}
