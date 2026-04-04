import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { StickyHeader } from "@/components/dashboard/StickyHeader";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Ghana Food Prices Dashboard",
  description: "Ghana food market prices monitoring dashboard",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <div className="min-h-screen bg-gray-50">
          <StickyHeader />
          <main className="max-w-7xl mx-auto px-6 py-8 pt-16">{children}</main>
          <footer className="border-t border-gray-200 mt-16 py-6 px-6">
            <div className="max-w-7xl mx-auto text-center text-xs text-gray-400">
              Data source: HDEX (WFP Food Prices) &amp; FAO FAOSTAT API &bull; Country: Ghana (GHA)
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
