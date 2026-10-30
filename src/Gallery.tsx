import { useState } from "react";
import { useAccount, useReadContracts } from "wagmi";
import { COMPANION_ADDRESS, chain, companionAbi } from "./config";

export interface TokenMeta {
  name: string;
  image: string;
  attributes: { trait_type: string; value: string | number }[];
}

/** Decodes the contract's base64 data URI. Returns undefined for anything else. */
export function decodeTokenUri(uri: unknown): TokenMeta | undefined {
  if (typeof uri !== "string") return undefined;
  const prefix = "data:application/json;base64,";
  if (!uri.startsWith(prefix)) return undefined;
  try {
    const bytes = Uint8Array.from(atob(uri.slice(prefix.length)), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as TokenMeta;
  } catch {
    return undefined;
  }
}

const PAGE = 12;
const SHOWN = ["Mood", "Wheel RPM", "Squeek Block", "Block Progress", "Feed", "Fur"];

/** Every minted companion, newest first, with traits re-read from the chain every 30 seconds. */
export function Gallery({ total, deployed }: { total: number | undefined; deployed: boolean | undefined }) {
  const { address } = useAccount();
  const [limit, setLimit] = useState(PAGE);
  const count = total ?? 0;
  const ids = Array.from({ length: Math.min(limit, count) }, (_, i) => count - i);

  const reads = useReadContracts({
    contracts: ids.flatMap((id) => [
      { address: COMPANION_ADDRESS, abi: companionAbi, functionName: "tokenURI", args: [BigInt(id)], chainId: chain.id },
      { address: COMPANION_ADDRESS, abi: companionAbi, functionName: "ownerOf", args: [BigInt(id)], chainId: chain.id },
    ]),
    query: { enabled: ids.length > 0, refetchInterval: 30_000 },
  });

  let body;
  if (deployed === false) {
    body = <p className="empty">The gallery fills up once the collection is deployed and the first companion is minted.</p>;
  } else if (total === undefined) {
    body = <p className="empty">Loading companions from Sepolia…</p>;
  } else if (count === 0) {
    body = <p className="empty">No companions yet. Mint the first one above.</p>;
  } else {
    body = (
      <ul className="grid">
        {ids.map((id, i) => {
          const meta = decodeTokenUri(reads.data?.[i * 2]?.result);
          const owner = reads.data?.[i * 2 + 1]?.result as string | undefined;
          const mine = !!address && owner?.toLowerCase() === address.toLowerCase();
          return (
            <li key={id} id={`token-${id}`} className={mine ? "card mine" : "card"}>
              {meta ? (
                <img src={meta.image} alt={`Companion #${id}, ${String(meta.attributes.find((a) => a.trait_type === "Mood")?.value ?? "")}`} width={400} height={400} loading="lazy" />
              ) : (
                <div className="art-placeholder" aria-hidden="true" />
              )}
              <div className="card-body">
                <h3>
                  Companion #{id}
                  {mine && <span className="tag">Yours</span>}
                </h3>
                {meta ? (
                  <dl className="traits">
                    {SHOWN.map((t) => {
                      const a = meta.attributes.find((x) => x.trait_type === t);
                      return a ? (
                        <div key={t}>
                          <dt>{t}</dt>
                          <dd className="num">{t === "Block Progress" ? `${a.value}%` : a.value}</dd>
                        </div>
                      ) : null;
                    })}
                  </dl>
                ) : (
                  <p className="muted">{reads.isError ? "Could not read this token. Retrying in 30 seconds." : "Reading traits…"}</p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <section className="section" aria-labelledby="gallery-title">
      <div className="section-head">
        <h2 id="gallery-title">Gallery</h2>
        <p className="muted">
          {count ? `${count} minted. ` : ""}Traits are read from the contract and refresh every 30 seconds.
        </p>
      </div>
      {body}
      {count > limit && (
        <button className="cta cta-quiet more" onClick={() => setLimit((l) => l + PAGE)}>
          Show {Math.min(PAGE, count - limit)} more
        </button>
      )}
    </section>
  );
}
