"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";

/** Adds the viewer's coordinates to the URL once, so server pages can sort by distance. */
export default function Locate() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    if (params.get("lat") || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((p) => {
      const next = new URLSearchParams(params);
      next.set("lat", p.coords.latitude.toFixed(5));
      next.set("lng", p.coords.longitude.toFixed(5));
      router.replace(`?${next}`);
    }, () => {}, { timeout: 8000, maximumAge: 300000 });
  }, [params, router]);
  return null;
}
