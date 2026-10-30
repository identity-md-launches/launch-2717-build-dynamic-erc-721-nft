import { useBytecode, useReadContract } from "wagmi";
import { companionSvg } from "./art";
import { COMPANION_ADDRESS, CORE_ADDRESS, EXPLORER, chain, companionAbi } from "./config";
import { Gallery } from "./Gallery";
import { MintPanel } from "./MintPanel";
import { isEnergetic, liveMood, useHamsterStatus, type HamsterStatus } from "./squeek";

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

function StatusPanel({ status, error }: { status?: HamsterStatus; error?: string }) {
  const mood = liveMood(status);
  const rows: [string, string][] = status
    ? [
        ["Wheel", status.coreStatus === "IDLE" ? "Idle" : status.coreStatus.charAt(0) + status.coreStatus.slice(1).toLowerCase()],
        ["Speed", `${fmt.format(status.rpm)} rpm`],
        ["Squeek block", fmt.format(status.blockHeight)],
        ["Distance run", `${fmt.format(status.distanceMm / 1_000_000)} km`],
      ]
    : [];
  return (
    <section className="status" aria-labelledby="status-title">
      <div className="status-head">
        <h2 id="status-title">Hamster now</h2>
        <span className={`pill ${isEnergetic(mood) ? "pill-on" : ""}`}>
          <span className="dot" aria-hidden="true" />
          {status ? mood : error ? "Feed unreachable" : "Loading…"}
        </span>
      </div>
      {status ? (
        <>
          <dl className="stats">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt>{k}</dt>
                <dd className="num">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="progress">
            <div className="progress-label">
              <span>Block {fmt.format(status.blockHeight + 1)} progress</span>
              <span className="num">{status.blockProgressPct.toFixed(1)}%</span>
            </div>
            <div className="bar" role="progressbar" aria-label="Squeek block progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(status.blockProgressPct)}>
              <span style={{ width: `${status.blockProgressPct}%` }} />
            </div>
          </div>
          <p className="muted small">
            {status.stale ? "The wheel sensor has not reported recently. " : ""}
            {error ? `${error}. Showing the last reading. ` : ""}
            Updated {new Date(status.observedAt).toLocaleTimeString()}, every 5 seconds.
          </p>
        </>
      ) : (
        <p className="muted">{error ? `${error}. Retrying every 5 seconds.` : "Reading the Squeekchain status feed…"}</p>
      )}
    </section>
  );
}

export default function App() {
  const { status, error } = useHamsterStatus();
  const code = useBytecode({ address: COMPANION_ADDRESS, chainId: chain.id, query: { refetchInterval: 60_000 } });
  const deployed = code.isSuccess ? !!code.data && code.data !== "0x" : code.isError ? false : undefined;
  const supply = useReadContract({
    address: COMPANION_ADDRESS,
    abi: companionAbi,
    functionName: "totalSupply",
    chainId: chain.id,
    query: { enabled: !!deployed, refetchInterval: 30_000 },
  });
  const total = deployed ? (supply.data !== undefined ? Number(supply.data as bigint) : undefined) : deployed === false ? 0 : undefined;
  const mood = liveMood(status);

  return (
    <>
      <header className="top">
        <a className="brand" href="#top">
          <img src="./favicon.svg" width={28} height={28} alt="" />
          Squeek Companion
        </a>
        <a className="top-link" href="#gallery-title">
          Gallery
        </a>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <h1>A hamster that wakes onchain</h1>
            <p className="lede">
              Mint a free companion on Sepolia. It zooms when the real Squeekchain hamster runs and sleeps when the wheel stops.
            </p>
            <MintPanel
              deployed={deployed}
              onChanged={() => {
                code.refetch();
                supply.refetch();
              }}
            />
          </div>
          <figure className="hero-art">
            <img
              src={companionSvg({ mood, rpm: status?.rpm ?? 0, blockHeight: status?.blockHeight ?? 0, progressPct: status?.blockProgressPct ?? 0 })}
              width={400}
              height={400}
              alt={`Live preview: the companion is ${mood.toLowerCase()}`}
            />
            <figcaption className="muted small">Live preview from the wheel feed</figcaption>
          </figure>
        </section>

        <StatusPanel status={status} error={error} />

        <Gallery total={total} deployed={deployed} />

        <section className="section how" aria-labelledby="how-title">
          <h2 id="how-title">How the traits change</h2>
          <ul className="moods">
            <li>
              <strong>Zooming</strong> 40 rpm or faster in the latest settled round. Sunny, wide awake, motion lines.
            </li>
            <li>
              <strong>Jogging</strong> turning, under 40 rpm. Same energetic style.
            </li>
            <li>
              <strong>Dozing</strong> ran in the last half hour, still now. Night sky, eyes shut.
            </li>
            <li>
              <strong>Sleeping</strong> no recent wheel work, or the feed stopped settling.
            </li>
          </ul>
          <p className="muted">
            The wheel ring on every token fills with progress through the current Squeek block. The contract reads SqueekCore on each
            tokenURI call, so wallets and marketplaces see the change on their next refresh. SqueekCore settles every 10 minutes, so
            tokens can trail the live feed above by one round.
          </p>
        </section>
      </main>

      <footer className="foot">
        <a href={`${EXPLORER}/address/${COMPANION_ADDRESS}`} target="_blank" rel="noreferrer">
          Collection contract
        </a>
        <a href={`${EXPLORER}/address/${CORE_ADDRESS}`} target="_blank" rel="noreferrer">
          SqueekCore
        </a>
        <a href="https://api.squeekchain.com/v1/status" target="_blank" rel="noreferrer">
          Status feed
        </a>
      </footer>
    </>
  );
}
