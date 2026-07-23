import type { Metadata } from "next";
import { SafetyCardExperience } from "@/components/safety-card-experience";

export const metadata: Metadata = {
  title: "Synthetic Control Self-Test · Runbook",
  description:
    "Reproduce Runbook's four-fixture synthetic control behavior locally, inspect the 26-scenario gap, and download the exact domain-verified evidence capsule.",
};

export default function SafetyCardPage() {
  return <SafetyCardExperience />;
}
