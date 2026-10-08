import Link from "next/link";
import { Suspense } from "react";
import { Badge, Counts } from "@/components/Counts";
import Locate from "@/components/Locate";
import { defaultArea } from "@/lib/areas";
import { formatDistance } from "@/lib/geo";
import { bestNear, dishTypes } from "@/lib/queries";
import { readAll } from "@/lib/store";

export const dynamic = "force-dynamic";

export default async function Best({ searchParams }: { searchParams: Promise<{ type?: string; lat?: string; lng?: string }> }) {
  const sp = await searchParams;
  const area = defaultArea();
  const lat = Number(sp.lat ?? area.center.lat), lng = Number(sp.lng ?? area.center.lng);
  const items = await readAll("menu_items");
  const available = new Set(items.filter((i) => i.active && i.dish_type).map((i) => i.dish_type!));
  const types = dishTypes().filter((t) => available.has(t));
  const type = sp.type && available.has(sp.type) ? sp.type : null;
  const results = type ? await bestNear(type, lat, lng) : [];
  const keep = (t: string) => `?${new URLSearchParams({ ...(sp.lat ? { lat: sp.lat, lng: sp.lng ?? "" } : {}), type: t })}`;

  return (
    <main>
      <Suspense><Locate /></Suspense>
      <h1>Best ___ near me</h1>
      {types.length === 0 ? <p className="muted">No menus loaded yet.</p> : (
        <div className="chips">
          {types.map((t) => <Link key={t} href={keep(t)} className={`chip${t === type ? " on" : ""}`}>{t}</Link>)}
        </div>
      )}
      {type && (
        <>
          <h2>{type} · {results.length} dishes</h2>
          <ol className="list">
            {results.map(({ item, restaurant, stats, distance }) => (
              <li key={item.id}>
                <Link className="card" href={`/r/${restaurant.id}`}>
                  <div className="row">
                    <div>
                      <div className="dish-name">{item.name}<Badge s={stats} /></div>
                      <div className="muted small">{restaurant.name} · {formatDistance(distance)}</div>
                    </div>
                    <Counts s={stats} />
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </>
      )}
    </main>
  );
}
