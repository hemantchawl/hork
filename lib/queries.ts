import { readFileSync } from "node:fs";
import path from "node:path";
import { distanceMeters } from "./geo";
import { latestVerdicts, stats, type DishStats } from "./score";
import { DATA_DIR, readAll } from "./store";
import type { Log, MenuItem, Restaurant, User } from "./types";

export function dishTypes(): string[] {
  return JSON.parse(readFileSync(path.join(DATA_DIR, "dish_types.json"), "utf8"));
}

export async function friendIds(userId: string | undefined) {
  if (!userId) return new Set<string>();
  const follows = await readAll("follows");
  return new Set(follows.filter((f) => f.follower_id === userId).map((f) => f.followee_id));
}

export async function nearby(lat: number, lng: number, limit = 15) {
  const restaurants = await readAll("restaurants");
  return restaurants
    .map((r) => ({ ...r, distance: distanceMeters({ lat, lng }, r) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

export interface MenuRow extends MenuItem {
  stats: DishStats;
  friends: { user: User; verdict: Log["verdict"] }[];
}

export async function restaurantMenu(restaurantId: string, viewer?: User | null) {
  const [restaurants, items, logs, users] = await Promise.all([
    readAll("restaurants"), readAll("menu_items"), readAll("logs"), readAll("users"),
  ]);
  const restaurant = restaurants.find((r) => r.id === restaurantId);
  if (!restaurant) return null;
  const friends = await friendIds(viewer?.id);
  const here = logs.filter((l) => l.restaurant_id === restaurantId);
  const verdicts = latestVerdicts(here);
  const byId = new Map(users.map((u) => [u.id, u]));

  const rows: MenuRow[] = items
    .filter((i) => i.restaurant_id === restaurantId && i.active)
    .map((i) => {
      const friendLogs = new Map<string, Log>();
      for (const l of here) {
        if (l.menu_item_id !== i.id || !friends.has(l.user_id)) continue;
        const prev = friendLogs.get(l.user_id);
        if (!prev || prev.created_at < l.created_at) friendLogs.set(l.user_id, l);
      }
      return {
        ...i,
        stats: stats(verdicts.get(i.id) ?? []),
        friends: [...friendLogs.values()].flatMap((l) => {
          const user = byId.get(l.user_id);
          return user ? [{ user, verdict: l.verdict }] : [];
        }),
      };
    });

  const sections = new Map<string, MenuRow[]>();
  for (const row of rows) {
    const key = row.source === "user" ? "Added by diners" : row.section ?? "Menu";
    sections.set(key, [...(sections.get(key) ?? []), row]);
  }
  return { restaurant, sections: [...sections.entries()], itemCount: rows.length };
}

/** "Best <dish_type> near me": every menu item of that type, ranked by score, then by ratings. */
export async function bestNear(dishType: string, lat: number, lng: number) {
  const [restaurants, items, logs] = await Promise.all([readAll("restaurants"), readAll("menu_items"), readAll("logs")]);
  const rById = new Map(restaurants.map((r) => [r.id, r]));
  const verdicts = latestVerdicts(logs);
  return items
    .filter((i) => i.active && i.dish_type === dishType && rById.has(i.restaurant_id))
    .map((i) => {
      const r = rById.get(i.restaurant_id)!;
      return { item: i, restaurant: r, stats: stats(verdicts.get(i.id) ?? []), distance: distanceMeters({ lat, lng }, r) };
    })
    .sort((a, b) => b.stats.score - a.stats.score || b.stats.total - a.stats.total || a.distance - b.distance);
}

export interface FeedEntry {
  log: Log;
  user: User;
  item: MenuItem;
  restaurant: Restaurant;
}

export async function feed(opts: { userIds?: Set<string>; limit?: number }) {
  const [logs, users, items, restaurants] = await Promise.all([
    readAll("logs"), readAll("users"), readAll("menu_items"), readAll("restaurants"),
  ]);
  const u = new Map(users.map((x) => [x.id, x]));
  const it = new Map(items.map((x) => [x.id, x]));
  const rs = new Map(restaurants.map((x) => [x.id, x]));
  return logs
    .filter((l) => !opts.userIds || opts.userIds.has(l.user_id))
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, opts.limit ?? 50)
    .flatMap((log): FeedEntry[] => {
      const user = u.get(log.user_id), item = it.get(log.menu_item_id), restaurant = rs.get(log.restaurant_id);
      return user && item && restaurant ? [{ log, user, item, restaurant }] : [];
    });
}
