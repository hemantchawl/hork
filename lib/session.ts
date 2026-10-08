import { readAll } from "./store";
import type { User } from "./types";

export function googleEnabled() {
  return Boolean(
    (process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID) &&
    (process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET),
  );
}

/** Handle-only sign-in: on by default when Google isn't configured; otherwise only with HORK_ALLOW_HANDLE_LOGIN=1. */
export function handleLoginAllowed() {
  const flag = process.env.HORK_ALLOW_HANDLE_LOGIN;
  return flag ? flag === "1" : !googleEnabled();
}

export async function currentUser(): Promise<User | null> {
  const { auth } = await import("./auth");
  const id = (await auth())?.user?.id;
  if (!id) return null;
  const users = await readAll("users");
  return users.find((u) => u.id === id) ?? null;
}

/** Admins are listed in HORK_ADMINS (comma-separated handles or emails). If unset, any signed-in tester is an admin. */
export function isAdmin(user: User | null) {
  if (!user) return false;
  const list = (process.env.HORK_ADMINS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return list.length === 0 || list.includes(user.handle) || (!!user.email && list.includes(user.email.toLowerCase()));
}
