"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Middleware enforces the actual owner-only boundary before protected HTML or
// API data is served. This client check only covers soft navigation/session
// expiry; it contains no password, API key, or browser-stored unlock flag.
export default function AuthGate({ children }) {
  const pathname = usePathname();
  const publicPage = pathname === "/access" || pathname?.startsWith("/portal/");
  const [authorized, setAuthorized] = useState(publicPage);

  useEffect(() => {
    if (publicPage) {
      setAuthorized(true);
      return;
    }
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" })
      .then((response) => response.json().then((body) => ({ response, body })))
      .then(({ response, body }) => {
        if (cancelled) return;
        if (response.ok && body.authenticated) setAuthorized(true);
        else window.location.replace(`/access?next=${encodeURIComponent(pathname || "/")}`);
      })
      .catch(() => {
        if (!cancelled) window.location.replace(`/access?next=${encodeURIComponent(pathname || "/")}`);
      });
    return () => { cancelled = true; };
  }, [pathname, publicPage]);

  return authorized ? children : null;
}
