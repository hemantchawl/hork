import { z } from "zod";
import { newId, update } from "./store";
import type { MenuItem, Restaurant } from "./types";

export const MenuSchema = z.object({
  is_menu: z.boolean().describe("false if the content is not a food or drink menu"),
  sections: z.array(z.object({
    name: z.string(),
    items: z.array(z.object({
      name: z.string(),
      description: z.string().nullable(),
      price: z.number().nullable().describe("Price in dollars; null if not shown or market price"),
      dish_type: z.string().nullable().describe("One value from the allowed dish_type list, or null"),
    })),
  })),
});
export type Menu = z.infer<typeof MenuSchema>;

export function menuRows(restaurantId: string, menu: Menu, src: { url: string | null; kind: MenuItem["source"] }, dishTypes: string[]) {
  const now = new Date().toISOString();
  if (!menu.is_menu) return [];
  return menu.sections.flatMap((s) => s.items.filter((i) => i.name.trim()).map((i): MenuItem => ({
    id: newId("m"), restaurant_id: restaurantId, section: s.name || null, name: i.name.trim(),
    description: i.description?.trim() || null,
    price_cents: i.price != null && i.price > 0 && i.price < 500 ? Math.round(i.price * 100) : null,
    dish_type: i.dish_type && dishTypes.includes(i.dish_type) ? i.dish_type : null,
    source: src.kind, source_url: src.url, active: true, created_at: now,
  })));
}

/**
 * Replace a restaurant's extracted menu. Dishes still on the menu keep their ids so existing logs
 * stay attached; dishes that disappeared are deactivated; diner-added items are never touched.
 */
export async function saveMenu(restaurantId: string, rows: MenuItem[], menuUrl: string | null, status: Restaurant["menu_status"]) {
  if (status === "loaded") {
    await update("menu_items", (items) => {
      const key = (i: { name: string; section: string | null }) => `${i.section ?? ""}|${i.name}`.toLowerCase().replace(/[^a-z0-9|]+/g, " ").trim();
      const old = new Map(items.filter((i) => i.restaurant_id === restaurantId && i.source !== "user").map((i) => [key(i), i]));
      for (const i of old.values()) i.active = false;
      for (const row of rows) {
        const prev = old.get(key(row));
        if (prev) Object.assign(prev, { ...row, id: prev.id, created_at: prev.created_at });
        else items.push(row);
      }
    });
  }
  await update("restaurants", (rs) => {
    const x = rs.find((y) => y.id === restaurantId);
    if (x) { x.menu_status = status; x.menu_url = menuUrl ?? x.menu_url; }
  });
}
