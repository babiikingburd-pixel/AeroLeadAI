"use client";
import CustomerPortal from "../../../components/CustomerPortal";

export default function PortalPage({ params }) {
  return <CustomerPortal token={params.token} />;
}
