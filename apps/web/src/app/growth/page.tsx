import type { Metadata } from "next";
import { GrowthCockpit } from "@/components/growth-cockpit";

export const metadata: Metadata = {
  title: "Growth cockpit · Runbook",
  description: "Preregister and measure manual creator experiments without scraping Social or manufacturing market activity.",
};

export default function GrowthPage() {
  return <GrowthCockpit />;
}
