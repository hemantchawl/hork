export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatDistance(m: number) {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1609.34).toFixed(1)} mi`;
}

export function mapsUrl(r: { name: string; address: string | null; lat: number; lng: number }) {
  const q = encodeURIComponent(r.address ? `${r.name}, ${r.address}` : `${r.lat},${r.lng}`);
  return `https://www.google.com/maps/search/?api=1&query=${q}`;
}
