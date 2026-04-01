"use client";

import { useEffect, useRef, useState } from "react";
import { NavLinks } from "./NavLinks";

export function StickyHeader() {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);

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
      className={`fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 py-4 transition-transform duration-300 ${
        visible ? "translate-y-0" : "-translate-y-full"
      }`}
    >
      <div className="max-w-7xl mx-auto px-6 flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-xl font-bold text-gray-900">CROPS</h1>
        <NavLinks />
      </div>
    </header>
  );
}
