// Exercises the Vercel Blob backend against an in-memory fake that enforces ETag preconditions,
// to check that concurrent updates from separate serverless instances don't lose writes.
import assert from "node:assert/strict";
import { mock, test } from "node:test";

class BlobError extends Error {}
class BlobPreconditionFailedError extends BlobError {}
const objects = new Map<string, { body: string; etag: string }>();
let n = 0;

mock.module("@vercel/blob", {
  namedExports: {
    BlobError,
    BlobPreconditionFailedError,
    async get(p: string, o: { ifNoneMatch?: string }) {
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      const obj = objects.get(p);
      if (!obj) return null;
      if (o.ifNoneMatch === obj.etag) return { statusCode: 304, stream: null, blob: { etag: obj.etag } };
      return { statusCode: 200, stream: new Response(obj.body).body, blob: { etag: obj.etag } };
    },
    async put(p: string, body: string, o: { allowOverwrite?: boolean; ifMatch?: string }) {
      await new Promise((r) => setTimeout(r, Math.random() * 5));
      const obj = objects.get(p);
      if (obj && !o.allowOverwrite) throw new BlobError("This blob already exists");
      if (o.ifMatch && obj?.etag !== o.ifMatch) throw new BlobPreconditionFailedError();
      const etag = `"e${++n}"`;
      objects.set(p, { body: String(body), etag });
      return { etag, url: `https://blob/${p}`, pathname: p };
    },
  },
});

process.env.HORK_STORAGE = "blob";
process.env.HORK_DATA_DIR = "/nonexistent"; // seed collections from empty arrays

test("concurrent updates on Blob all land", async () => {
  const { readAll, update } = await import("./store");
  await Promise.all(Array.from({ length: 25 }, (_, i) => update("follows", (rows) => {
    rows.push({ follower_id: `u${i}`, followee_id: "x" });
  })));
  const rows = await readAll("follows");
  assert.equal(rows.length, 25);
  assert.equal(new Set(rows.map((r) => r.follower_id)).size, 25);
});
