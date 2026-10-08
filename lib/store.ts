// JSON-file storage for the prototype. Each collection is one file in data/.
// Writes are serialized per file and replaced atomically (write temp file, then rename).
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Follow, Log, MenuItem, Restaurant, User } from "./types";

export const DATA_DIR = process.env.HORK_DATA_DIR ?? path.join(process.cwd(), "data");

interface Collections {
  restaurants: Restaurant;
  menu_items: MenuItem;
  users: User;
  follows: Follow;
  logs: Log;
}
type Name = keyof Collections;

const locks = new Map<Name, Promise<unknown>>();

function file(name: Name) {
  return path.join(DATA_DIR, `${name}.json`);
}

export async function readAll<N extends Name>(name: N): Promise<Collections[N][]> {
  try {
    return JSON.parse(await fs.readFile(file(name), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

async function writeAll<N extends Name>(name: N, rows: Collections[N][]) {
  const target = file(name);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(rows, null, 2) + "\n");
  await fs.rename(tmp, target);
}

/** Read-modify-write a collection under a per-file lock. */
export async function update<N extends Name, R>(
  name: N,
  fn: (rows: Collections[N][]) => R | Promise<R>,
): Promise<R> {
  const prev = locks.get(name) ?? Promise.resolve();
  let result!: R;
  const next = prev.then(async () => {
    const rows = await readAll(name);
    result = await fn(rows);
    await writeAll(name, rows);
  });
  locks.set(name, next.catch(() => {}));
  await next;
  return result;
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}
