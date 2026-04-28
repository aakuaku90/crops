import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { StickyHeader } from "@/components/dashboard/StickyHeader";
import { AppShell } from "@/components/dashboard/AppShell";
import { Toaster } from "sonner";

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
        <div className="min-h-screen bg-background text-foreground">
          <StickyHeader />
          <AppShell>{children}</AppShell>
          <footer className="border-t border-border mt-16 h-[66px] px-6 lg:pl-56 flex items-center">
            <div className="max-w-[1600px] mx-auto text-center text-xs text-muted-foreground w-full">
              Data source: HDEX (WFP Food Prices) &amp; FAO FAOSTAT API &bull; Country: Ghana (GHA)
            </div>
          </footer>
        </div>
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
