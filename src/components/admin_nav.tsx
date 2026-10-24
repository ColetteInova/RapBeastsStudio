"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/admin", label: "Studio" },
  { href: "/admin/treino", label: "Treino de rimas" },
];

export default function AdminNav() {
  const pathname = usePathname();
  return (
    <nav className="admin-nav">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          className={`admin-nav-link${pathname === link.href ? " active" : ""}`}
          href={link.href}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
