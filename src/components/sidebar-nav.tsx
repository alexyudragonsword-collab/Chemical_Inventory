"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS: { href: string; label: string; icon: string; adminOnly?: boolean }[] = [
  { href: "/dashboard", label: "Dashboard", icon: "⌂" },
  { href: "/inventory", label: "Inventory", icon: "▤" },
  { href: "/availability", label: "Where is it?", icon: "⌕" },
  { href: "/check-in", label: "Check-In", icon: "↓" },
  { href: "/check-out", label: "Check-Out", icon: "↑" },
  { href: "/transfers", label: "Transfers", icon: "⇄" },
  { href: "/stocktake", label: "Stocktake", icon: "✓" },
  { href: "/safety", label: "Safety", icon: "⚠" },
  { href: "/reports", label: "Reports", icon: "◱" },
  { href: "/admin", label: "Admin", icon: "⚙", adminOnly: true },
];

export function SidebarNav({ showAdmin }: { showAdmin: boolean }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-col gap-0.5 px-2">
      {ITEMS.filter((i) => !i.adminOnly || showAdmin).map((item) => {
        const active = pathname === item.href || pathname.startsWith(item.href + "/");
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
              active ? "bg-white/15 font-medium text-white" : "text-white/70 hover:bg-white/10 hover:text-white"
            }`}
          >
            <span className="w-4 text-center">{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
