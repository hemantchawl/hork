// Prototype sign-in: pick a handle, stored in a cookie. No passwords - invite-only test.
import { cookies } from "next/headers";
import { readAll } from "./store";
import type { User } from "./types";

export const COOKIE = "hork_user";

export async function currentUser(): Promise<User | null> {
  const id = (await cookies()).get(COOKIE)?.value;
  if (!id) return null;
  const users = await readAll("users");
  return users.find((u) => u.id === id) ?? null;
}

/** Admins are listed in HORK_ADMINS (comma-separated handles). If unset, any signed-in tester is an admin. */
export function isAdmin(user: User | null) {
  if (!user) return false;
  const list = (process.env.HORK_ADMINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length === 0 || list.includes(user.handle);
}
