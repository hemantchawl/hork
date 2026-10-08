import { nearby } from "@/lib/queries";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return Response.json({ error: "lat and lng required" }, { status: 400 });
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  let rows = await nearby(lat, lng, q ? 400 : 15);
  if (q) rows = rows.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 15);
  return Response.json(rows.map((r) => ({
    id: r.id, name: r.name, category: r.category, address: r.address, distance: r.distance, menu_status: r.menu_status,
  })));
}
