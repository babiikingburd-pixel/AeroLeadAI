"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const AMBER = "#f5a623";
const SLATE = "#0b0f16";
const PANEL = "#141b26";
const LINE = "#232f3e";
const MUTE = "#6b7c93";

const TABS = [
  { href: "/", label: "Console" },
  { href: "/discovery", label: "Discovery" },
  { href: "/batch", label: "Batch / Mass Upload" },
  { href: "/map", label: "Lead Map" },
  { href: "/scanner", label: "Background Scanner" },
  { href: "/jobs", label: "Jobs" },
  { href: "/dashboard", label: "Dashboard" },
  { href: "/crm", label: "CRM" },
  { href: "/ops", label: "Ops Center" },
  { href: "/intelligence", label: "Intelligence" },
  { href: "/enterprise", label: "Enterprise" },
  { href: "/executive", label: "Executive" },
];

export default function TopNav() {
  const pathname = usePathname();

  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 50,
        background: SLATE,
        borderBottom: `1px solid ${LINE}`,
        display: "flex",
        alignItems: "center",
        gap: 4,
        padding: "0 12px",
        overflowX: "auto",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: 2, color: AMBER, fontFamily: "monospace", padding: "14px 12px 14px 4px", whiteSpace: "nowrap" }}>
        AEROLEADAI
      </div>
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            style={{
              padding: "14px 16px",
              fontSize: 13,
              fontWeight: active ? 700 : 500,
              color: active ? "#dfe6ee" : MUTE,
              textDecoration: "none",
              whiteSpace: "nowrap",
              borderBottom: active ? `2px solid ${AMBER}` : "2px solid transparent",
              marginBottom: -1,
            }}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
