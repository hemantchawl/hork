"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

interface Row { id: string; name: string; category: string | null; address: string | null; distance: number; menu_status: string }

function fmt(m: number) {
  return m < 1000 ? `${Math.round(m / 10) * 10} m` : `${(m / 1609.34).toFixed(1)} mi`;
}

export default function NearbyList({ fallback }: { fallback: { lat: number; lng: number; name: string } }) {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [where, setWhere] = useState("Finding where you are…");
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setPos(fallback); setWhere(`Showing ${fallback.name}`);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setWhere("Closest to you"); },
      () => { setPos(fallback); setWhere(`Location off — showing ${fallback.name}`); },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 60000 },
    );
  }, [fallback]);

  useEffect(() => {
    if (!pos) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/nearby?lat=${pos.lat}&lng=${pos.lng}&q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        .then((r) => r.json()).then(setRows).catch(() => {});
    }, q ? 200 : 0);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [pos, q]);

  return (
    <>
      <input type="search" placeholder="Search restaurants" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search restaurants" />
      <p className="muted small">{where}</p>
      {!rows ? <p className="muted">Loading…</p> : rows.length === 0 ? <p className="muted">No matches.</p> : (
        <ul className="list">
          {rows.map((r, i) => (
            <li key={r.id}>
              <Link href={`/r/${r.id}`} className="card">
                <div className="row">
                  <div>
                    <div className="dish-name">
                      {r.name}
                      {i === 0 && !q && <span className="badge top">You&apos;re here?</span>}
                      {r.menu_status !== "loaded" && <span className="badge status">no menu yet</span>}
                    </div>
                    <div className="muted small">{[r.category?.replace(/_/g, " "), r.address].filter(Boolean).join(" · ")}</div>
                  </div>
                  <span className="counts">{fmt(r.distance)}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
