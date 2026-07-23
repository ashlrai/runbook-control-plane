import type { Metadata } from "next";
import { LineageAtlas } from "@/components/lineage-atlas";

export const metadata: Metadata = {
  title: "Local Lineage Atlas · Runbook",
  description:
    "Analyze a bounded set of .runbook capsules locally, resolve only loaded valid parent declarations, and export metadata-only lineage evidence.",
};

export default function LineageAtlasPage() {
  return <LineageAtlas />;
}
