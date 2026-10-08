import { readPhoto } from "@/lib/store";

const TYPES: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic" };

export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  if (!/^p_[a-z0-9]+\.(jpg|png|webp|heic)$/.test(name)) return new Response("Not found", { status: 404 });
  const body = await readPhoto(name);
  if (!body) return new Response("Not found", { status: 404 });
  return new Response(Buffer.isBuffer(body) ? new Uint8Array(body) : (body as ReadableStream<Uint8Array>), {
    headers: { "Content-Type": TYPES[name.split(".").pop()!], "Cache-Control": "private, max-age=31536000, immutable" },
  });
}
