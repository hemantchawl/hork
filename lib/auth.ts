import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Google from "next-auth/providers/google";
import { handleLoginAllowed } from "@/lib/session";
import { newId, update } from "@/lib/store";
import type { User } from "@/lib/types";

function googleClient() {
  return {
    clientId: process.env.AUTH_GOOGLE_ID ?? process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.AUTH_GOOGLE_SECRET ?? process.env.GOOGLE_CLIENT_SECRET,
  };
}

function secret() {
  const s = process.env.AUTH_SECRET ?? process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production" && process.env.HORK_INSECURE_DEV_SESSIONS !== "1") {
    throw new Error("AUTH_SECRET or SESSION_SECRET must be set (32+ characters) in production");
  }
  return "hork-dev-only-secret-do-not-use-in-production";
}

/** A unique handle from the email's local part, e.g. "beth.lee@gmail.com" -> "bethlee" or "bethlee2". */
function pickHandle(email: string, taken: Set<string>) {
  const base = (email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "") || "eater").slice(0, 20).padEnd(2, "0");
  let h = base;
  for (let n = 2; taken.has(h); n++) h = `${base}${n}`;
  return h;
}

async function upsertGoogleUser(profile: { sub: string; email: string; name: string | null; picture: string | null }) {
  return update("users", (users): User => {
    const existing = users.find((u) => u.google_sub === profile.sub)
      ?? users.find((u) => !u.google_sub && u.email?.toLowerCase() === profile.email.toLowerCase());
    if (existing) {
      Object.assign(existing, { google_sub: profile.sub, email: profile.email, avatar_url: profile.picture ?? existing.avatar_url });
      return existing;
    }
    const u: User = {
      id: newId("u"), handle: pickHandle(profile.email, new Set(users.map((x) => x.handle))),
      display_name: profile.name ?? profile.email.split("@")[0], created_at: new Date().toISOString(),
      google_sub: profile.sub, email: profile.email, avatar_url: profile.picture ?? undefined,
    };
    users.push(u);
    return u;
  });
}

async function upsertHandleUser(handle: string, displayName: string) {
  return update("users", (users) => {
    const existing = users.find((u) => u.handle === handle);
    if (existing) return existing;
    const u: User = { id: newId("u"), handle, display_name: displayName || handle, created_at: new Date().toISOString() };
    users.push(u);
    return u;
  });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  secret: secret(),
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 180 },
  pages: { signIn: "/me" },
  providers: [
    Google({
      ...googleClient(),
      // Testers may already have a JSON user with this email (handle login). Link it.
      allowDangerousEmailAccountLinking: true,
    }),
    Credentials({
      credentials: { handle: { type: "text" }, display_name: { type: "text" } },
      async authorize(credentials) {
        if (!handleLoginAllowed()) return null;
        const handle = String(credentials.handle ?? "").trim().toLowerCase().replace(/^@/, "");
        if (!/^[a-z0-9_]{2,24}$/.test(handle)) return null;
        const displayName = String(credentials.display_name ?? "").trim();
        const user = await upsertHandleUser(handle, displayName);
        return { id: user.id, name: user.display_name, email: user.email };
      },
    }),
  ],
  callbacks: {
    async signIn({ account, profile }) {
      if (account?.provider !== "google") return true;
      const email = typeof profile?.email === "string" ? profile.email : null;
      const verified = (profile as { email_verified?: boolean } | undefined)?.email_verified === true;
      return Boolean(email && verified);
    },
    async jwt({ token, user, account, profile }) {
      if (account?.provider === "google") {
        const email = typeof profile?.email === "string" ? profile.email : user?.email;
        if (!email) return token;
        const name = user?.name ?? (typeof profile?.name === "string" ? profile.name : null);
        const picture = user?.image ?? (typeof (profile as { picture?: unknown } | undefined)?.picture === "string"
          ? (profile as { picture: string }).picture : null);
        const horkUser = await upsertGoogleUser({ sub: account.providerAccountId, email, name, picture });
        token.id = horkUser.id;
      } else if (user?.id) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.id) session.user.id = token.id as string;
      return session;
    },
  },
});
