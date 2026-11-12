import type { Metadata } from "next";
import { connection } from "next/server";
import { Roboto } from "next/font/google";
import MockBadge from "@/features/mock/MockBadge";
import Sidebar from "@/features/nav/Sidebar";
import "./globals.css";

const roboto = Roboto({
  variable: "--font-roboto",
  subsets: ["latin"],
  weight: ["300", "400", "500", "700"],
});

export const metadata: Metadata = {
  title: "Torchbearer",
  description: "Capture, map and teach expert judgment with a voice agent.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every page per request so the sign-in check (src/proxy.ts) always runs before a page is served.
  await connection();
  return (
    <html lang="en" className={`${roboto.variable} h-full antialiased`}>
      <body className="flex h-full overflow-hidden font-sans">
        <Sidebar />
        <main className="min-h-0 min-w-0 flex-1 overflow-auto">{children}</main>
        <MockBadge />
      </body>
    </html>
  );
}
