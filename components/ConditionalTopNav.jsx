"use client";
import { usePathname } from "next/navigation";
import TopNav from "./TopNav";

// The internal nav (Console/Batch/Discovery/etc.) doesn't belong on the
// customer-facing portal — a homeowner shouldn't see or be able to click
// into internal tooling from their own job page.
export default function ConditionalTopNav() {
  const pathname = usePathname();
  if (pathname?.startsWith("/portal/")) return null;
  return <TopNav />;
}
