import type { Log, Verdict } from "./types";

export interface DishStats {
  love: number;
  fine: number;
  skip: number;
  total: number;
  score: number; // 0..1, pulled toward 0.5 when there are few ratings
  badge: "top" | "skip" | null;
}

export const TOP_PICK_MIN_SCORE = 0.7;
export const MIN_RATINGS_FOR_BADGE = 3;

/** score = (loves + 0.5 * fines + 1) / (ratings + 2) */
export function stats(verdicts: Verdict[]): DishStats {
  const love = verdicts.filter((v) => v === "love").length;
  const fine = verdicts.filter((v) => v === "fine").length;
  const skip = verdicts.filter((v) => v === "skip").length;
  const total = verdicts.length;
  const score = (love + 0.5 * fine + 1) / (total + 2);
  let badge: DishStats["badge"] = null;
  if (total >= MIN_RATINGS_FOR_BADGE) {
    if (skip > total / 2) badge = "skip";
    else if (score >= TOP_PICK_MIN_SCORE) badge = "top";
  }
  return { love, fine, skip, total, score, badge };
}

/** Latest verdict per user per dish, so re-logging a dish doesn't double-count. */
export function latestVerdicts(logs: Log[]): Map<string, Verdict[]> {
  const latest = new Map<string, Log>();
  for (const l of logs) {
    const key = `${l.menu_item_id}:${l.user_id}`;
    const prev = latest.get(key);
    if (!prev || prev.created_at < l.created_at) latest.set(key, l);
  }
  const byItem = new Map<string, Verdict[]>();
  for (const l of latest.values()) {
    const arr = byItem.get(l.menu_item_id) ?? [];
    arr.push(l.verdict);
    byItem.set(l.menu_item_id, arr);
  }
  return byItem;
}
