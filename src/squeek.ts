import { useEffect, useState } from "react";
import { STATUS_URL } from "./config";

/** The fields of api.squeekchain.com/v1/status the companion uses. */
export interface HamsterStatus {
  coreStatus: string; // e.g. "IDLE", "SPINNING"
  rpm: number;
  speedMmPerSecond: number;
  distanceMm: number;
  freshness: string; // "online" when the wheel sensor is reporting
  observedAt: string;
  stale: boolean;
  blockHeight: number;
  blockProgressPct: number; // 0-100 through the current Squeek block
  settledRound: number;
}

export type Mood = "Zooming" | "Jogging" | "Dozing" | "Sleeping" | "Offline";

/** Same thresholds as the contract: 40 rpm and up zooms, any turning jogs, otherwise asleep. */
export const ZOOM_RPM = 40;

export function liveMood(s: HamsterStatus | undefined): Mood {
  if (!s) return "Offline";
  if (s.stale) return "Sleeping";
  if (s.rpm >= ZOOM_RPM) return "Zooming";
  if (s.rpm > 0 || s.coreStatus !== "IDLE") return "Jogging";
  return "Sleeping";
}

export const isEnergetic = (m: Mood) => m === "Zooming" || m === "Jogging";

const BLOCK_UNITS = 1e9;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseStatus(raw: any, now = Date.now()): HamsterStatus {
  const m = raw?.measurement ?? {};
  const anchor = raw?.settlementQueue?.projected ?? raw?.builder?.projected ?? raw?.builder?.anchor ?? {};
  const observedAt = String(m.observedAt ?? raw?.generatedAt ?? "");
  const age = (now - Date.parse(observedAt)) / 1000;
  const staleAfter = Number(m.staleAfterSeconds ?? 120);
  return {
    coreStatus: String(m.coreStatus ?? "UNKNOWN"),
    rpm: Number(m.rpmMilli ?? 0) / 1000,
    speedMmPerSecond: Number(m.speedMmPerSecond ?? 0),
    distanceMm: Number(m.distanceMm ?? 0),
    freshness: String(m.freshness ?? "unknown"),
    observedAt,
    stale: m.freshness !== "online" || !(age <= staleAfter),
    blockHeight: Number(anchor.blockHeight ?? 0),
    blockProgressPct: Math.min(99.99, (Number(anchor.blockProgress ?? 0) / BLOCK_UNITS) * 100),
    settledRound: Number(raw?.builder?.anchor?.settledThroughRound ?? 0),
  };
}

/** Polls the Squeekchain status feed. Keeps the last good reading when a poll fails. */
export function useHamsterStatus(intervalMs = 5000) {
  const [status, setStatus] = useState<HamsterStatus>();
  const [error, setError] = useState<string>();
  useEffect(() => {
    let live = true;
    const load = async () => {
      try {
        const res = await fetch(STATUS_URL, { cache: "no-store" });
        if (!res.ok) throw new Error(`Status feed answered ${res.status}`);
        const next = parseStatus(await res.json());
        if (live) {
          setStatus(next);
          setError(undefined);
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : "Status feed unreachable");
      }
    };
    load();
    const t = setInterval(load, intervalMs);
    return () => {
      live = false;
      clearInterval(t);
    };
  }, [intervalMs]);
  return { status, error };
}
