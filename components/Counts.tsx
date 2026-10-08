import type { DishStats } from "@/lib/score";

export function Counts({ s }: { s: DishStats }) {
  if (!s.total) return <span className="counts">No ratings yet</span>;
  return (
    <span className="counts" title={`Score ${(s.score * 100).toFixed(0)}`}>
      <span className="l">♥ {s.love}</span> · <span className="f">~ {s.fine}</span> · <span className="s">✕ {s.skip}</span>
    </span>
  );
}

export function Badge({ s }: { s: DishStats }) {
  if (s.badge === "top") return <span className="badge top">Top pick</span>;
  if (s.badge === "skip") return <span className="badge skip">Skip it</span>;
  return null;
}

export const VERDICT_LABEL = { love: "♥ Loved", fine: "~ Fine", skip: "✕ Skip" } as const;
