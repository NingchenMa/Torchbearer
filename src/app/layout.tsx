import type { Metadata } from "next";
import { connection } from "next/server";
import { Lato, Libre_Caslon_Display, Libre_Caslon_Text, Roboto } from "next/font/google";
import MockBadge from "@/features/mock/MockBadge";
import AppNav from "@/features/nav/AppNav";
import "./globals.css";

// Fonts of the product website: Libre Caslon for headings, Lato for reading text.
// Roboto stays for the Ledgerline sample site.
const roboto = Roboto({ variable: "--font-roboto", subsets: ["latin"], weight: ["300", "400", "500", "700"] });
const lato = Lato({ variable: "--font-lato", subsets: ["latin"], weight: ["400", "700", "900"] });
const caslonDisplay = Libre_Caslon_Display({ variable: "--font-caslon-display", subsets: ["latin"], weight: "400" });
const caslonText = Libre_Caslon_Text({ variable: "--font-caslon-text", subsets: ["latin"], weight: ["400"], style: ["normal", "italic"] });

export const metadata: Metadata = {
  title: "Torchbearer",
  description: "Capture, map and teach expert judgment with a voice agent.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render every page per request so the sign-in check (src/proxy.ts) always runs before a page is served.
  await connection();
  return (
    <html lang="en" className={`${roboto.variable} ${lato.variable} ${caslonDisplay.variable} ${caslonText.variable} h-full antialiased`}>
      <body className="flex h-full flex-col overflow-hidden font-sans">
        <AppNav />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
        <MockBadge />
      </body>
    </html>
  );
}
