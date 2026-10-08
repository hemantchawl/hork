import { readFileSync } from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./store";

export interface Area {
  name: string;
  center: { lat: number; lng: number };
  bbox: { west: number; south: number; east: number; north: number };
}

export function areas(): Record<string, Area> {
  return JSON.parse(readFileSync(path.join(DATA_DIR, "areas.json"), "utf8"));
}

export function defaultArea(): Area {
  return Object.values(areas())[0];
}
