/**
 * Import a menu that was extracted elsewhere (by hand, or by Claude in another tool) as JSON
 * in the same shape the loader uses: { is_menu, sections: [{ name, items: [{ name, description, price, dish_type }] }] }.
 *
 *   npx tsx scripts/import-menu.ts <restaurant id> <menu.json> <source url> [web|pdf|photo]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { MenuSchema, menuRows, saveMenu } from "../lib/menus";
import { DATA_DIR, readAll } from "../lib/store";

const [id, file, url, kind = "web"] = process.argv.slice(2);
if (!id || !file || !url) {
  console.error("usage: tsx scripts/import-menu.ts <restaurant id> <menu.json> <source url> [web|pdf|photo]");
  process.exit(1);
}
const r = (await readAll("restaurants")).find((x) => x.id === id);
if (!r) throw new Error(`No restaurant ${id}`);
const dishTypes: string[] = JSON.parse(await fs.readFile(path.join(DATA_DIR, "dish_types.json"), "utf8"));
const menu = MenuSchema.parse(JSON.parse(await fs.readFile(file, "utf8")));
const rows = menuRows(r.id, menu, { url, kind: kind as "web" | "pdf" | "photo" }, dishTypes);
await saveMenu(r.id, rows, url, rows.length >= 3 ? "loaded" : "needs_photo");
console.log(`${r.name}: ${rows.length} dishes imported from ${url}`);
