"use server";

import { promises as fs } from "node:fs";
import path from "node:path";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { currentUser, endSession, handleLoginAllowed, isAdmin, startSession } from "@/lib/session";
import { DATA_DIR, newId, readAll, update } from "@/lib/store";
import type { MenuItem, Verdict } from "@/lib/types";

const VERDICTS: Verdict[] = ["love", "fine", "skip"];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const PHOTO_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic" };

/** Only allow same-site paths ("/x"), never "//host" or "/\\host", as redirect targets. */
function safePath(p: string, fallback = "/") {
  return /^\/(?![/\\])/.test(p) ? p : fallback;
}

async function requireUser(next: string) {
  const user = await currentUser();
  if (!user) redirect(`/me?next=${encodeURIComponent(next)}`);
  return user;
}

export async function signIn(formData: FormData) {
  if (!handleLoginAllowed()) throw new Error("Handle sign-in is turned off; use Google");
  const handle = String(formData.get("handle") ?? "").trim().toLowerCase().replace(/^@/, "");
  const displayName = String(formData.get("display_name") ?? "").trim();
  const next = safePath(String(formData.get("next") ?? "/"));
  if (!/^[a-z0-9_]{2,24}$/.test(handle)) redirect(`/me?error=handle&next=${encodeURIComponent(next)}`);

  const user = await update("users", (users) => {
    const existing = users.find((u) => u.handle === handle);
    if (existing) return existing;
    const u = { id: newId("u"), handle, display_name: displayName || handle, created_at: new Date().toISOString() };
    users.push(u);
    return u;
  });
  await startSession(user.id);
  redirect(next);
}

export async function signOut() {
  await endSession();
  redirect("/");
}

export async function updateProfile(formData: FormData) {
  const user = await requireUser("/me");
  const handle = String(formData.get("handle") ?? "").trim().toLowerCase().replace(/^@/, "");
  const displayName = String(formData.get("display_name") ?? "").trim().slice(0, 40);
  if (!/^[a-z0-9_]{2,24}$/.test(handle)) redirect("/me?error=handle");
  const ok = await update("users", (users) => {
    if (users.some((u) => u.handle === handle && u.id !== user.id)) return false;
    const me = users.find((u) => u.id === user.id)!;
    me.handle = handle;
    if (displayName) me.display_name = displayName;
    return true;
  });
  redirect(ok ? "/me" : "/me?error=taken");
}

export async function logDish(formData: FormData) {
  const itemId = String(formData.get("menu_item_id"));
  const user = await requireUser(`/log/${itemId}`);
  const verdict = String(formData.get("verdict")) as Verdict;
  if (!VERDICTS.includes(verdict)) throw new Error("Pick Love, Fine or Skip");
  const item = (await readAll("menu_items")).find((i) => i.id === itemId);
  if (!item) throw new Error("Dish not found");

  let photo: string | null = null;
  const file = formData.get("photo");
  if (file instanceof File && file.size > 0) {
    const ext = PHOTO_TYPES[file.type];
    if (!ext || file.size > MAX_PHOTO_BYTES) throw new Error("Photo must be a JPEG, PNG, WebP or HEIC under 8 MB");
    photo = `${newId("p")}.${ext}`;
    const dir = path.join(DATA_DIR, "uploads");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, photo), Buffer.from(await file.arrayBuffer()));
  }

  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  await update("logs", (logs) => {
    logs.push({
      id: newId("l"), user_id: user.id, menu_item_id: item.id, restaurant_id: item.restaurant_id,
      verdict, note, photo, created_at: new Date().toISOString(),
    });
  });
  revalidatePath(`/r/${item.restaurant_id}`);
  redirect(`/r/${item.restaurant_id}?logged=${item.id}`);
}

export async function addDish(formData: FormData) {
  const restaurantId = String(formData.get("restaurant_id"));
  const user = await requireUser(`/r/${restaurantId}`);
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  if (!name) throw new Error("Dish name is required");
  const item: MenuItem = {
    id: newId("m"), restaurant_id: restaurantId, section: null, name,
    description: String(formData.get("description") ?? "").trim().slice(0, 300) || null,
    price_cents: null, dish_type: String(formData.get("dish_type") ?? "") || null,
    source: "user", source_url: null, active: true, added_by: user.id, created_at: new Date().toISOString(),
  };
  await update("menu_items", (items) => { items.push(item); });
  redirect(`/log/${item.id}`);
}

export async function toggleFollow(formData: FormData) {
  const target = String(formData.get("user_id"));
  const back = safePath(String(formData.get("back") ?? "/people"), "/people");
  const user = await requireUser(back);
  if (target === user.id) redirect(back);
  await update("follows", (follows) => {
    const i = follows.findIndex((f) => f.follower_id === user.id && f.followee_id === target);
    if (i >= 0) follows.splice(i, 1);
    else follows.push({ follower_id: user.id, followee_id: target });
  });
  revalidatePath(back);
  redirect(back);
}

/** Admin: paste menu lines as "Section | Dish | Price | dish_type | Description". */
export async function importMenu(formData: FormData) {
  const user = await requireUser("/admin");
  if (!isAdmin(user)) throw new Error("Admins only");
  const restaurantId = String(formData.get("restaurant_id"));
  const sourceUrl = String(formData.get("source_url") ?? "").trim() || null;
  const now = new Date().toISOString();
  const rows: MenuItem[] = String(formData.get("lines") ?? "")
    .split("\n").map((l) => l.trim()).filter(Boolean)
    .map((line) => {
      const [section, name, price, dishType, description] = line.split("|").map((s) => s?.trim() || "");
      const p = Number(price.replace(/[$,]/g, ""));
      return {
        id: newId("m"), restaurant_id: restaurantId, section: section || null, name,
        description: description || null, price_cents: price && Number.isFinite(p) ? Math.round(p * 100) : null,
        dish_type: dishType || null, source: "web" as const, source_url: sourceUrl, active: true, created_at: now,
      };
    })
    .filter((r) => r.name);
  await update("menu_items", (items) => { items.push(...rows); });
  await update("restaurants", (rs) => {
    const r = rs.find((x) => x.id === restaurantId);
    if (r && rows.length) { r.menu_status = "loaded"; r.menu_url = sourceUrl ?? r.menu_url; }
  });
  redirect(`/r/${restaurantId}`);
}
