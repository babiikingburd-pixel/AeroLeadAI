"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

// Superseded by the generalized /twincities/reports/[contractor] page (see
// lib/twincities/contractors.js). Kept as a redirect so any /twincities/apex10
// link already shared with APEX Exteriors keeps working.
export default function Apex10Redirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/twincities/reports/apex-exteriors");
  }, [router]);
  return null;
}
