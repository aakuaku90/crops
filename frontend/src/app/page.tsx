"use client";

import Link from "next/link";
import { useState } from "react";

const sections = [
  {
    href: "/tracker",
    label: "Demand & Supply",
    description: "National food supply, demand signals, and market price trends in one view.",
    activeColor: "bg-gray-900 text-white",
    inactiveColor: "bg-gray-100 hover:bg-gray-200",
    iconColor: "text-white",
    inactiveIconColor: "text-gray-700",
    icon: (
      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z" />
      </svg>
    ),
  },
  {
    href: "/dashboard",
    label: "WFP Food Prices",
    description: "Market-level food price trends across Ghana from WFP and HDEX datasets.",
    activeColor: "bg-green-600 text-white",
    inactiveColor: "bg-green-200 hover:bg-green-300",
    iconColor: "text-white",
    inactiveIconColor: "text-green-600",
    icon: (
      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
      </svg>
    ),
  },
  {
    href: "/fao",
    label: "FAO Indicators",
    description: "National agricultural indicators from FAOSTAT — production, trade, food security, and more.",
    activeColor: "bg-blue-600 text-white",
    inactiveColor: "bg-blue-200 hover:bg-blue-300",
    iconColor: "text-white",
    inactiveIconColor: "text-blue-600",
    icon: (
      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
  },
  {
    href: "/gss",
    label: "GSS Sub-national Data",
    description: "District and regional crop production estimates from the Ghana Statistical Service.",
    activeColor: "bg-amber-500 text-white",
    inactiveColor: "bg-amber-200 hover:bg-amber-300",
    iconColor: "text-white",
    inactiveIconColor: "text-amber-500",
    icon: (
      <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 6.75V15m6-6v8.25m.503 3.498l4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 00-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0z" />
      </svg>
    ),
  },
];

export default function LandingPage() {
  const [active, setActive] = useState(0);

  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-12">
      {/* Hero */}
      <div className="text-center max-w-2xl mx-auto mb-8">
        <span className="inline-block mb-4 rounded-full bg-green-700 px-3 py-1 text-xs font-medium text-white uppercase tracking-wide">
          Ghana Agricultural Data
        </span>
        <h1 className="text-4xl font-bold text-gray-900 mb-4 leading-tight">
          Ghana&apos;s food demand &amp;<br />supply tracker
        </h1>
        <p className="text-lg text-gray-500 mb-0">
          Track food supply, demand, and price trends across Ghana — so you can make faster, more informed decisions.
        </p>
      </div>

      {/* Section cards */}
      <div className="flex flex-col sm:flex-row w-full max-w-3xl rounded-2xl border border-gray-200 p-1.5 gap-1.5">
        {sections.map(({ href, label, description, activeColor, inactiveColor, iconColor, inactiveIconColor, icon }, i) => {
          const isActive = active === i;
          return (
            <Link
              key={href}
              href={href}
              onClick={() => setActive(i)}
              className={`flex-1 rounded-xl p-5 transition-all ${isActive ? activeColor : inactiveColor}`}
            >
              <div className={`mb-3 ${isActive ? iconColor : inactiveIconColor}`}>{icon}</div>
              <h3 className={`font-semibold mb-1 text-sm ${isActive ? "text-white" : "text-gray-900"}`}>{label}</h3>
              <p className={`text-xs leading-relaxed ${isActive ? "text-white/80" : "text-gray-500"}`}>{description}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
