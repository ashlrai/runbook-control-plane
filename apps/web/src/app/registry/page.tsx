import type { Metadata } from "next";
import { RegistryExplorer } from "@/components/registry-explorer";

export const metadata: Metadata = {
  title: "Capability Registry · Runbook",
  description:
    "Browse the offline public-derived Robinhood Trading and Banking capability inventory, mutation classes, and frozen fixture admit/reject summaries. Not live inventory. Not authorization.",
};

export default function RegistryPage() {
  return <RegistryExplorer />;
}
