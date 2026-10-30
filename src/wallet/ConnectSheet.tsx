import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect, useSwitchChain, type Connector } from "wagmi";
import { chain } from "../config";
import { WALLET_ICONS } from "./wallet-icons";
import { OPEN_IN, isMobileBrowser } from "./open-in";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;
const svgSrc = (svg: string) => `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

/** The connect control and its sheet: the site's own type and colors, the network's structure. */
export function ConnectSheet({ open: forced, mobile: forcedMobile }: { open?: boolean; mobile?: boolean }) {
  const mobile = forcedMobile ?? isMobileBrowser();
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, variables, error, reset } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(forced ?? false);
  const opener = useRef<HTMLButtonElement>(null);
  const sheet = useRef<HTMLDivElement>(null);

  const close = () => {
    setOpen(false);
    reset();
    opener.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    sheet.current?.querySelector<HTMLElement>("a, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (isConnected) setOpen(false);
  }, [isConnected]);

  // EIP-6963 names each installed extension; wagmi's generic injected row is only for a browser
  // where discovery found nothing, and then it is called what it is.
  const named = connectors.some((c) => c.type === "injected" && c.id !== "injected");
  const listed = [...connectors.filter((c) => c.type === "injected"), ...connectors.filter((c) => c.type !== "injected")].filter(
    (c) => !(c.id === "injected" && named),
  );
  const label = (c: Connector) =>
    c.id === "injected" ? "Browser wallet" : c.id === "coinbaseWalletSDK" && mobile ? "Coinbase Smart Wallet" : c.name;
  const icon = (c: Connector) => c.icon ?? (WALLET_ICONS[c.id] ? svgSrc(WALLET_ICONS[c.id]!) : undefined);

  if (isConnected && address) {
    if (chainId !== chain.id) {
      return (
        <button className="cta" disabled={switching} onClick={() => switchChain({ chainId: chain.id })}>
          {switching ? "Switching…" : `Switch to ${chain.name}`}
        </button>
      );
    }
    return (
      <button className="cta cta-quiet" onClick={() => disconnect()} title="Disconnect">
        <span className="num">{short(address)}</span> · Disconnect
      </button>
    );
  }
  return (
    <>
      <button ref={opener} className="cta" onClick={() => setOpen(true)} aria-haspopup="dialog">
        Connect
      </button>
      {open && (
        <div className="sheet-bg" onClick={close}>
          <div ref={sheet} className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheet-title" onClick={(e) => e.stopPropagation()}>
            <div className="sheet-head">
              <h2 id="sheet-title">Connect a wallet</h2>
              <button className="x" aria-label="Close" onClick={close}>
                ×
              </button>
            </div>
            {mobile &&
              OPEN_IN.map((w) => (
                <a key={w.id} className="row" href={w.href(location.href)}>
                  <span className="ic">{WALLET_ICONS[w.id] && <img width={28} height={28} src={svgSrc(WALLET_ICONS[w.id]!)} alt="" />}</span>
                  <span>Open in {w.name}</span>
                </a>
              ))}
            {listed
              .filter((c) => !mobile || c.type !== "injected")
              .map((c) => (
                <button key={c.uid} className="row" onClick={() => connect({ connector: c })} disabled={isPending}>
                  <span className="ic">{icon(c) && <img width={28} height={28} src={icon(c)} alt="" />}</span>
                  <span>
                    {label(c)}
                    {isPending && variables?.connector === c ? " · opening…" : ""}
                  </span>
                </button>
              ))}
            {error && !isPending && (
              <p className="note" role="status">
                {/rejected|denied/i.test(error.message) ? "Request declined in the wallet. Pick a wallet to try again." : "That wallet did not connect. Pick a wallet to try again."}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
