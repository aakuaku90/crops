"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, LineChart } from "lucide-react";
import { LogoMark } from "./LogoMark";

export function StickyHeader() {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);
  const pathname = usePathname();
  // Landing surfaces (the same set the Sidebar treats as `isLanding`) show
  // the dark "Data" pill linking to /analysis/supply. Anything else is an
  // inner data page and shows the "Home" pill instead.
  const isLanding =
    pathname === "/" ||
    pathname === "/map" ||
    pathname === "/crops" ||
    pathname === "/trends" ||
    pathname.startsWith("/forecast");
  const isInner = !isLanding;

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 10) {
        setVisible(true);
      } else if (y < lastY.current) {
        setVisible(true);
      } else if (y > lastY.current) {
        setVisible(false);
      }
      lastY.current = y;
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 bg-background/80 backdrop-blur border-b border-border py-2.5 transition-transform duration-300 ${
        visible ? "translate-y-0" : "-translate-y-full"
      }`}
    >
      <div className="max-w-[1600px] mx-auto px-6 flex items-center justify-between gap-6">
        <Link
          href="/"
          className="flex items-center gap-1 text-2xl font-bold tracking-tight text-foreground hover:opacity-70 transition-opacity shrink-0 leading-none"
        >
          <LogoMark className="w-7 h-7 text-foreground" />
          <span className="leading-none">CROPS</span>
        </Link>
        {isInner ? (
          <Link
            href="/"
            className="flex items-center gap-2 rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-muted transition-colors"
          >
            <Home className="w-3.5 h-3.5" />
            Home
          </Link>
        ) : (
          <Link
            href="/analysis/supply"
            className="flex items-center gap-2 rounded-full bg-foreground text-background px-4 py-1.5 text-sm font-medium hover:bg-foreground/90 transition-colors"
          >
            <LineChart className="w-3.5 h-3.5" />
            Data
          </Link>
        )}
      </div>
    </header>
  );
}
