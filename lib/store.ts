// JSON storage for the prototype. Each collection is one JSON document.
//
// Two backends, chosen at runtime:
// - Local files in data/ (default): writes are serialized per file and replaced atomically.
// - Vercel Blob (when BLOB_READ_WRITE_TOKEN is set, or HORK_STORAGE=blob): each collection is a private
//   blob at `<prefix><name>.json`, seeded from the bundled data/ file the first time it's needed. Writes use
//   ETag-conditional puts (ifMatch) and retry on conflict, so concurrent serverless requests can't lose updates.
import { promises as fs } from "node:fs";
import path from "node:path";
import { BlobError, BlobPreconditionFailedError, get, put } from "@vercel/blob";
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

export function storageKind(): "file" | "blob" {
  const forced = process.env.HORK_STORAGE;
  if (forced === "file" || forced === "blob") return forced;
  return process.env.BLOB_READ_WRITE_TOKEN ? "blob" : "file";
}

const BLOB_PREFIX = process.env.HORK_BLOB_PREFIX ?? "hork/";
export const blobPath = (name: string) => `${BLOB_PREFIX}${name}`;

function file(name: Name) {
  return path.join(DATA_DIR, `${name}.json`);
}

async function readFile<N extends Name>(name: N): Promise<Collections[N][]> {
  try {
    return JSON.parse(await fs.readFile(file(name), "utf8"));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}

// ---------- file backend ----------

const locks = new Map<Name, Promise<unknown>>();

async function writeFile<N extends Name>(name: N, rows: Collections[N][]) {
  const target = file(name);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(tmp, JSON.stringify(rows, null, 2) + "\n");
  await fs.rename(tmp, target);
}

async function updateFile<N extends Name, R>(name: N, fn: (rows: Collections[N][]) => R | Promise<R>): Promise<R> {
  const prev = locks.get(name) ?? Promise.resolve();
  let result!: R;
  const next = prev.then(async () => {
    const rows = await readFile(name);
    result = await fn(rows);
    await writeFile(name, rows);
  });
  locks.set(name, next.catch(() => {}));
  await next;
  return result;
}

// ---------- blob backend ----------

interface Snapshot { etag: string | null; rows: unknown[] }
// Per-instance cache: a conditional GET (ifNoneMatch) returns 304 while the blob is unchanged.
const blobCache = new Map<Name, Snapshot>();

async function readBlob(name: Name): Promise<Snapshot> {
  const cached = blobCache.get(name);
  const res = await get(blobPath(`${name}.json`), {
    access: "private", useCache: false, ...(cached?.etag ? { ifNoneMatch: cached.etag } : {}),
  });
  if (!res) {
    // Not in Blob yet: start from the copy bundled with the deployment.
    return { etag: null, rows: await readFile(name) };
  }
  if (res.statusCode === 304 && cached) return cached;
  if (res.statusCode !== 200) throw new Error(`Unexpected Blob status ${res.statusCode} for ${name}`);
  const snap = { etag: res.blob.etag, rows: JSON.parse(await new Response(res.stream).text()) };
  blobCache.set(name, snap);
  return snap;
}

function isConflict(e: unknown) {
  return e instanceof BlobPreconditionFailedError || (e instanceof BlobError && /exist/i.test(e.message));
}

async function updateBlob<N extends Name, R>(name: N, fn: (rows: Collections[N][]) => R | Promise<R>): Promise<R> {
  for (let attempt = 0; ; attempt++) {
    const snap = await readBlob(name);
    const rows = structuredClone(snap.rows) as Collections[N][];
    const result = await fn(rows);
    try {
      const written = await put(blobPath(`${name}.json`), JSON.stringify(rows), {
        access: "private",
        contentType: "application/json",
        addRandomSuffix: false,
        // Overwrite only the version we read; create only if nobody created it meanwhile.
        ...(snap.etag ? { allowOverwrite: true, ifMatch: snap.etag } : { allowOverwrite: false }),
      });
      blobCache.set(name, { etag: written.etag, rows });
      return result;
    } catch (e) {
      if (!isConflict(e) || attempt >= 6) throw e;
      blobCache.delete(name);
      await new Promise((r) => setTimeout(r, 50 * 2 ** attempt + Math.random() * 50));
    }
  }
}

// ---------- public API ----------

export async function readAll<N extends Name>(name: N): Promise<Collections[N][]> {
  if (storageKind() === "blob") return (await readBlob(name)).rows as Collections[N][];
  return readFile(name);
}

/**
 * Read-modify-write a collection. `fn` may mutate `rows` and return a result; the write is atomic per
 * collection. On Blob, `fn` can run more than once if another request wrote first, so keep it side-effect free.
 */
export async function update<N extends Name, R>(name: N, fn: (rows: Collections[N][]) => R | Promise<R>): Promise<R> {
  return storageKind() === "blob" ? updateBlob(name, fn) : updateFile(name, fn);
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

// ---------- photos ----------

export async function savePhoto(fileName: string, body: Buffer, contentType: string) {
  if (storageKind() === "blob") {
    await put(blobPath(`uploads/${fileName}`), body, { access: "private", contentType, addRandomSuffix: false });
    return;
  }
  const dir = path.join(DATA_DIR, "uploads");
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, fileName), body);
}

/** Returns the photo bytes as a stream or buffer, or null if missing. */
export async function readPhoto(fileName: string): Promise<ReadableStream<Uint8Array> | Buffer | null> {
  if (storageKind() === "blob") {
    const res = await get(blobPath(`uploads/${fileName}`), { access: "private" });
    return res?.statusCode === 200 ? res.stream : null;
  }
  try {
    return await fs.readFile(path.join(DATA_DIR, "uploads", fileName));
  } catch {
    return null;
  }
}
