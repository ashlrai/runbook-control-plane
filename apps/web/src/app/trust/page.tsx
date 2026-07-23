import type { Metadata } from "next";
import { TrustCenter } from "@/components/trust-center";

export const metadata: Metadata = {
  title: "Trust Center · Runbook",
  description: "Verify a metadata-only Runbook proof artifact locally and inspect its exact assurance limits.",
};

export default function TrustCenterPage() {
  return <TrustCenter />;
}
