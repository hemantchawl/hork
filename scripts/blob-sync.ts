/**
 * Move data between this checkout's data/ folder and the Vercel Blob store the deployed app uses.
 * Needs BLOB_READ_WRITE_TOKEN (Vercel → Storage → your Blob store → .env.local, or `vercel env pull`).
 *
 *   npx tsx scripts/blob-sync.ts status                 # what's in Blob vs data/
 *   npx tsx scripts/blob-sync.ts pull                   # back up Blob data to data/backups/<timestamp>/
 *   npx tsx scripts/blob-sync.ts push restaurants menu_items
 *        # upload the catalogue after re-running the loaders; dishes testers added in the app are kept
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR, readAll, update } from "../lib/store";
import type { MenuItem, Restaurant } from "../lib/types";

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  console.error("Set BLOB_READ_WRITE_TOKEN first (Vercel → Storage → Blob store → .env.local).");
  process.exit(1);
}
process.env.HORK_STORAGE = "blob";

const ALL = ["restaurants", "menu_items", "users", "follows", "logs"] as const;
type Name = (typeof ALL)[number];
const [cmd, ...rest] = process.argv.slice(2);
const local = async (name: Name) => JSON.parse(await fs.readFile(path.join(DATA_DIR, `${name}.json`), "utf8")) as unknown[];

if (cmd === "status") {
  for (const n of ALL) console.log(`${n.padEnd(12)} blob: ${String((await readAll(n)).length).padStart(6)}   local: ${(await local(n)).length}`);
} else if (cmd === "pull") {
  const dir = path.join(DATA_DIR, "backups", new Date().toISOString().replace(/[:.]/g, "-"));
  await fs.mkdir(dir, { recursive: true });
  for (const n of ALL) {
    const rows = await readAll(n);
    await fs.writeFile(path.join(dir, `${n}.json`), JSON.stringify(rows, null, 2) + "\n");
    console.log(`${n}: ${rows.length} rows`);
  }
  console.log(`Saved to ${path.relative(process.cwd(), dir)}`);
} else if (cmd === "push") {
  const names = rest.filter((n): n is "restaurants" | "menu_items" => n === "restaurants" || n === "menu_items");
  if (!names.length) {
    console.error("push takes restaurants and/or menu_items (tester data only lives in Blob).");
    process.exit(1);
  }
  for (const n of names) {
    if (n === "menu_items") {
      const mine = (await local(n)) as MenuItem[];
      const ids = new Set(mine.map((i) => i.id));
      const kept = await update("menu_items", (rows) => {
        const userAdded = rows.filter((i) => i.source === "user" && !ids.has(i.id));
        rows.splice(0, rows.length, ...mine, ...userAdded);
        return userAdded.length;
      });
      console.log(`menu_items: pushed ${mine.length}, kept ${kept} dishes added by testers`);
    } else {
      const mine = (await local(n)) as Restaurant[];
      await update("restaurants", (rows) => { rows.splice(0, rows.length, ...mine); });
      console.log(`restaurants: pushed ${mine.length}`);
    }
  }
} else {
  console.error("usage: blob-sync.ts status | pull | push restaurants menu_items");
  process.exit(1);
}
