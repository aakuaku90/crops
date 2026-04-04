"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const links = [
  { href: "/tracker", label: "Tracker" },
  { href: "/dashboard", label: "Food Prices" },
  { href: "/fao", label: "FAO Indicators" },
  { href: "/gss", label: "GSS Data" },
];

export function NavLinks() {
  const pathname = usePathname();
  const [active, setActive] = useState<"login" | "signup">("login");

  if (pathname === "/") return (
    <div className="flex items-center rounded-full border border-gray-200 p-1">
      <button
        onClick={() => setActive("login")}
        className={`rounded-full px-4 py-1 text-sm font-medium transition-colors ${
          active === "login"
            ? "bg-gray-900 text-white"
            : "text-gray-600 hover:text-gray-900"
        }`}
      >
        Log in
      </button>
      <button
        onClick={() => setActive("signup")}
        className={`rounded-full px-4 py-1 text-sm font-medium transition-colors ${
          active === "signup"
            ? "bg-gray-900 text-white"
            : "text-gray-600 hover:text-gray-900"
        }`}
      >
        Sign up
      </button>
    </div>
  );

  return (
    <nav className="flex items-center rounded-full border border-gray-200 p-1 text-sm font-medium">
      {links.map(({ href, label }) => {
        const isActive = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-full px-4 py-1 transition-colors ${
              isActive
                ? "bg-gray-900 text-white"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
