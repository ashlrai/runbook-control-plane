import type { Metadata } from "next";
import { GrowthBaselineCapture } from "@/components/growth-baseline-capture";

export const metadata: Metadata = {
  title: "Robinhood Social Baseline · Runbook",
  description:
    "Manually record non-identifying Robinhood Social profile and aggregate post counts in local browser storage without Robinhood access or scraping.",
};

export default function GrowthBaselinePage() {
  return <GrowthBaselineCapture />;
}
