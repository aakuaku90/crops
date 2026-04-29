"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoMark } from "./LogoMark";

interface NavItem {
  href: string;
  label: string;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

// Data-page sidebar: section-grouped, matches the docs-style aesthetic.
// Datasets = browse/sync a single source. Analysis = synthesized views that
// cross multiple sources to answer a question.
const DATA_SECTIONS: NavSection[] = [
  {
    title: "Datasets",
    items: [
      { href: "/dashboard", label: "WFP Food Prices" },
      { href: "/fao", label: "FAO Indicators" },
      { href: "/gss", label: "GSS Sub-national" },
      { href: "/yields/maize", label: "MOFA Maize Regional" },
      { href: "/climate", label: "Climate (NASA / MODIS)" },
    ],
  },
  {
    title: "Analysis",
    items: [
      { href: "/analysis/supply", label: "Supply" },
      { href: "/analysis/demand", label: "Demand" },
      { href: "/analysis/prices", label: "Prices" },
      { href: "/analysis/trade", label: "Trade" },
      { href: "/analysis/climate", label: "Climate Trends" },
      { href: "/analysis/maize", label: "Maize Trends" },
    ],
  },
  {
    title: "Predictions",
    items: [
      { href: "/predictions/maize", label: "Maize Yield (TabPFN)" },
      { href: "/predictions/maize-lightgbm", label: "Maize Yield (LightGBM)" },
      { href: "/predictions/maize-rolling", label: "Maize Yield (5-yr Mean)" },
      { href: "/predictions/maize-prices", label: "Maize Prices (Prophet)" },
    ],
  },
  {
    title: "Evaluation",
    items: [
      { href: "/evaluation/maize", label: "Maize Models" },
    ],
  },
];

// Landing-group sidebar: single flat list. Used on both `/` (Signals) and
// `/map` (Historical Outlook) — both are top-level overview surfaces.
const LANDING_ITEMS: NavItem[] = [
  { href: "/",          label: "Today" },
  { href: "/forecast",  label: "Demand & Supply" },
  { href: "/forecast/maize", label: "Yield Forecasts" },
  { href: "/forecast/maize-prices", label: "Price Forecasts" },
  { href: "/trends",    label: "Historical Trends" },
  { href: "/map",       label: "Historical Outlook" },
];

export function Sidebar() {
  const pathname = usePathname();
  const isLanding =
    pathname === "/" ||
    pathname === "/map" ||
    pathname === "/crops" ||
    pathname === "/trends" ||
    pathname.startsWith("/forecast");

  return (
    <aside className="hidden lg:flex flex-col fixed top-0 left-0 z-40 h-screen w-64 border-r border-border bg-card/40">
      <div className="flex flex-col h-full px-4 pt-4 bg-card/40 backdrop-blur">
        <Link
          href="/"
          className="flex items-center gap-1 text-2xl font-bold tracking-tight text-foreground hover:opacity-70 transition-opacity leading-none px-2 mb-5"
        >
          <LogoMark className="w-7 h-7 text-foreground" />
          <span className="leading-none">CROPS</span>
        </Link>

        {/* `overflow-y-auto` so the nav scrolls inside the sidebar on short
            viewports instead of pushing SystemStatus off the bottom. The
            scrollbar-thin utility (tailwindcss-animate ships it) keeps the
            track unobtrusive when it does appear. -mx-4 + px-4 lets the
            scrollbar sit flush with the sidebar edge. pb-4 adds breathing
            room so the last nav item doesn't kiss the SystemStatus border. */}
        <div className="flex-1 min-h-0 overflow-y-auto -mx-4 px-4 pb-4 [scrollbar-width:thin]">
          {isLanding ? (
            <nav>
              <ul className="space-y-1">
                {LANDING_ITEMS.map((item) => {
                  const isActive = pathname === item.href;
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        className={`block rounded-lg px-3 py-2 text-base font-medium transition-colors ${
                          isActive
                            ? "bg-foreground text-background"
                            : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                        }`}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ) : (
            <nav className="space-y-5">
              {DATA_SECTIONS.map((section) => (
                <div key={section.title}>
                  <div className="px-3 mb-1 text-lg font-bold uppercase tracking-wider text-foreground">
                    {section.title}
                  </div>
                  <ul className="space-y-1">
                    {section.items.map((item) => {
                      const isActive = pathname === item.href;
                      return (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className={`block rounded-lg px-3 py-2 text-base font-medium transition-colors ${
                              isActive
                                ? "bg-foreground text-background"
                                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            }`}
                          >
                            {item.label}
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </nav>
          )}
        </div>

        <SystemStatus />
      </div>
    </aside>
  );
}

function SystemStatus() {
  // Placeholder — wire to /health or a real "last sync" endpoint later.
  // py-4 (32px) + eyebrow line (~12px) + mb-1 (4px) + status text (~16px) = 64px,
  // matching the page footer (py-6 + text-xs ≈ 64px) so the bottom strip
  // reads as one continuous horizontal band.
  // Fixed h-[66px] matches the page footer so both bottom strips align.
  return (
    <div className="border-t border-border h-[66px] -mx-4 px-4 flex flex-col justify-center">
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-success animate-pulse shrink-0" />
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground leading-tight">
          System Status
        </span>
      </div>
      <div className="text-xs text-muted-foreground truncate leading-tight">
        HDEX synced 2 hours ago
      </div>
    </div>
  );
}
