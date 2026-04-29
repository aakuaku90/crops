"use client";

import { Sidebar } from "./Sidebar";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Sidebar />
      {/* lg:pl-64 reserves space for the fixed sidebar; max-w-[1600px] still
          centers the actual content area. */}
      <div className="lg:pl-64">
        <div className="max-w-[1600px] mx-auto">
          <main className="px-6 py-6 pt-20">{children}</main>
        </div>
      </div>
    </>
  );
}
