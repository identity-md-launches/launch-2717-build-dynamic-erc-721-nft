import { createConfig, http } from "wagmi";
import { sepolia } from "wagmi/chains";
import { coinbaseWallet, injected } from "wagmi/connectors";
import type { Abi, Address, Hex } from "viem";
import companion from "./generated/companion.json";

export const SITE_NAME = "Squeek Companion";
export const SITE_DESCRIPTION =
  "A free ERC-721 hamster on Sepolia whose mood and artwork follow the real Squeekchain wheel.";

export const chain = sepolia;
/** Public Sepolia RPC used for every read and named as the data source. */
export const PUBLIC_RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
/** Squeekchain's public status feed: live wheel rpm and core status, CORS-open. */
export const STATUS_URL = "https://api.squeekchain.com/v1/status";
export const EXPLORER = "https://sepolia.etherscan.io";

/** The collection's CREATE2 address; it is the same for whoever deploys it. */
export const COMPANION_ADDRESS = companion.address as Address;
/** SqueekCore the collection reads: the core the status feed settles to. */
export const CORE_ADDRESS = companion.core as Address;
/** The deterministic deployment proxy that places the collection at COMPANION_ADDRESS. */
export const CREATE2_FACTORY = companion.factory as Address;
export const CREATE2_CALLDATA = (companion.salt + companion.initCode.slice(2)) as Hex;
export const companionAbi = companion.abi as Abi;

export const walletConnectProjectId = ""; // only when the brief supplies one

export const config = createConfig({
  chains: [chain],
  // EIP-6963 discovery lists every installed extension under its own name
  multiInjectedProviderDiscovery: true,
  connectors: [injected(), coinbaseWallet({ appName: SITE_NAME })],
  transports: { [chain.id]: http(PUBLIC_RPC_URL) },
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
