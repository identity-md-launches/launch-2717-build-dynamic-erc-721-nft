import { useEffect } from "react";
import { useAccount, useReadContract, useSendTransaction, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { COMPANION_ADDRESS, CREATE2_CALLDATA, CREATE2_FACTORY, EXPLORER, chain, companionAbi } from "./config";
import { ConnectSheet } from "./wallet/ConnectSheet";

const friendly = (e: Error | null) => {
  if (!e) return undefined;
  if (/rejected|denied/i.test(e.message)) return "You declined the request in your wallet. Nothing was sent.";
  if (/AlreadyMinted/i.test(e.message)) return "This wallet has already minted its companion.";
  if (/insufficient funds/i.test(e.message)) return "This wallet needs a little Sepolia ETH for gas. Get some from a Sepolia faucet, then try again.";
  return "The transaction did not go through. Check your wallet and try again.";
};

/** The page's main action: connect, then mint once; or, before launch, deploy the collection. */
export function MintPanel({ deployed, onChanged }: { deployed: boolean | undefined; onChanged: () => void }) {
  const { address, isConnected, chainId } = useAccount();
  const onChain = isConnected && chainId === chain.id;

  const minted = useReadContract({
    address: COMPANION_ADDRESS,
    abi: companionAbi,
    functionName: "mintedBy",
    args: address ? [address] : undefined,
    chainId: chain.id,
    query: { enabled: !!address && !!deployed },
  });
  const myToken = minted.data ? Number(minted.data as bigint) : 0;

  const mint = useWriteContract();
  const mintReceipt = useWaitForTransactionReceipt({ hash: mint.data, chainId: chain.id });
  const deploy = useSendTransaction();
  const deployReceipt = useWaitForTransactionReceipt({ hash: deploy.data, chainId: chain.id });

  useEffect(() => {
    if (mintReceipt.isSuccess || deployReceipt.isSuccess) {
      minted.refetch();
      onChanged();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mintReceipt.isSuccess, deployReceipt.isSuccess]);

  const busyMint = mint.isPending || mintReceipt.isLoading;
  const busyDeploy = deploy.isPending || deployReceipt.isLoading;
  const err = friendly(mint.error ?? deploy.error);

  let action;
  if (!onChain) {
    action = <ConnectSheet />;
  } else if (deployed === undefined) {
    action = <button className="cta" disabled>Checking the collection…</button>;
  } else if (!deployed) {
    action = (
      <button className="cta" disabled={busyDeploy} onClick={() => deploy.sendTransaction({ to: CREATE2_FACTORY, data: CREATE2_CALLDATA })}>
        {busyDeploy ? "Deploying…" : "Deploy the collection"}
      </button>
    );
  } else if (myToken) {
    action = (
      <a className="cta cta-quiet" href={`#token-${myToken}`}>
        View your companion #{myToken}
      </a>
    );
  } else {
    action = (
      <button
        className="cta"
        disabled={busyMint || minted.isLoading}
        onClick={() => mint.writeContract({ address: COMPANION_ADDRESS, abi: companionAbi, functionName: "mint", chainId: chain.id })}
      >
        {mint.isPending ? "Confirm in your wallet…" : mintReceipt.isLoading ? "Minting…" : "Mint free companion"}
      </button>
    );
  }

  return (
    <div className="mint">
      <div className="mint-row">
        {action}
        {onChain && <ConnectSheet />}
      </div>
      <p className="hint" aria-live="polite">
        {err ??
          (mintReceipt.isSuccess
            ? `Minted. Your companion is #${myToken || "…"} in the gallery below.`
            : deployReceipt.isSuccess
              ? "Collection deployed. You can mint now."
              : !isConnected
                ? "Free on Sepolia, one per wallet. You only pay testnet gas."
                : !onChain
                  ? `Your wallet is on another network. Switch to ${chain.name} to mint.`
                  : deployed === false
                    ? "The collection is not on Sepolia yet. Anyone can deploy it once, at its fixed address."
                    : myToken
                      ? "One per wallet: this wallet has its companion."
                      : "Free, one per wallet. You only pay Sepolia gas.")}
        {(mint.data || deploy.data) && (
          <>
            {" "}
            <a href={`${EXPLORER}/tx/${mint.data ?? deploy.data}`} target="_blank" rel="noreferrer">
              View transaction
            </a>
          </>
        )}
      </p>
    </div>
  );
}
