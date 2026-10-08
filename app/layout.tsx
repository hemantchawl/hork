import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Hork — what to order",
  description: "Good for you. You found this place. Now, what to order.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#fd6c01" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="top">
          <Link href="/" className="brand" aria-label="Hork home">
            <img src="/logo.png" alt="" width={32} height={32} />
            <span>Hork</span>
          </Link>
          <span className="muted small">What&apos;s good?</span>
        </header>
        {children}
        <nav className="tabs" aria-label="Main">
          <Link href="/">Here</Link>
          <Link href="/best">Best near me</Link>
          <Link href="/stream">Stream</Link>
          <Link href="/me">Me</Link>
        </nav>
      </body>
    </html>
  );
}
