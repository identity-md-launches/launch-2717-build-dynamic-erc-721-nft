import { isEnergetic, type Mood } from "./squeek";

/**
 * The live preview: the same artwork the contract draws in tokenURI, built from the status feed so
 * the page can show the companion before anyone has minted. Keep in step with SqueekCompanion._svg.
 */
export function companionSvg(o: { mood: Mood; rpm: number; blockHeight: number; progressPct: number; fur?: string }) {
  const active = isEnergetic(o.mood);
  const fur = o.fur ?? "#E8A54B";
  const arc = Math.round((o.progressPct / 100) * 754);
  const ink = active ? "#3A2410" : "#F4E9C8";
  const bg = active
    ? `<rect width="400" height="400" fill="#FFE3A3"/><g stroke="#F08A24" stroke-width="6" stroke-linecap="round" opacity=".7"><path d="M40 150h50M28 190h56M40 230h44"/></g>`
    : `<rect width="400" height="400" fill="#1E2340"/><circle cx="330" cy="70" r="26" fill="#F4E9C8"/><circle cx="342" cy="62" r="24" fill="#1E2340"/><g fill="#F4E9C8"><circle cx="60" cy="60" r="2"/><circle cx="120" cy="40" r="1.5"/><circle cx="260" cy="36" r="2"/><circle cx="90" cy="110" r="1.5"/></g>`;
  const wheel = `<circle cx="200" cy="200" r="120" fill="none" stroke="${active ? "#F3C46B" : "#2E3560"}" stroke-width="14"/><circle cx="200" cy="200" r="120" fill="none" stroke="${active ? "#F08A24" : "#7C86C9"}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${arc} 754" transform="rotate(-90 200 200)"/>`;
  const hamster = active
    ? `<g transform="rotate(-8 200 230)"><ellipse cx="200" cy="232" rx="74" ry="56" fill="${fur}"/><ellipse cx="206" cy="246" rx="44" ry="30" fill="#FFF4E0"/><circle cx="150" cy="186" r="16" fill="${fur}"/><circle cx="246" cy="186" r="16" fill="${fur}"/><circle cx="176" cy="220" r="9" fill="#2A2018"/><circle cx="226" cy="220" r="9" fill="#2A2018"/><circle cx="179" cy="217" r="3" fill="#fff"/><circle cx="229" cy="217" r="3" fill="#fff"/><ellipse cx="201" cy="238" rx="7" ry="5" fill="#E46A6A"/><path d="M190 250q11 10 22 0" stroke="#2A2018" stroke-width="3" fill="none" stroke-linecap="round"/><g fill="#E9A6A0"><ellipse cx="160" cy="288" rx="14" ry="8"/><ellipse cx="244" cy="288" rx="14" ry="8"/></g></g>`
    : `<ellipse cx="200" cy="262" rx="84" ry="42" fill="${fur}"/><ellipse cx="200" cy="276" rx="56" ry="20" fill="#FFF4E0"/><circle cx="148" cy="236" r="14" fill="${fur}"/><circle cx="252" cy="236" r="14" fill="${fur}"/><path d="M168 258q10 8 20 0M212 258q10 8 20 0" stroke="#2A2018" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="200" cy="270" rx="6" ry="4" fill="#E46A6A"/><text x="262" y="196" fill="#F4E9C8" font-size="28" font-weight="700">z</text><text x="284" y="168" fill="#F4E9C8" font-size="22" font-weight="700">z</text>`;
  const caption = `<text x="24" y="368" fill="${ink}" font-size="26" font-weight="700">${o.mood}</text><text x="376" y="368" text-anchor="end" fill="${ink}" font-size="16">${Math.round(o.rpm)} rpm · block ${o.blockHeight} · ${Math.floor(o.progressPct)}%</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400" font-family="ui-sans-serif,system-ui,sans-serif">${bg}${wheel}${hamster}${caption}</svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
