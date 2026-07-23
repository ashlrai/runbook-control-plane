import type { Metadata } from "next";
import { ExperimentBuilder } from "@/components/experiment-builder";

export const metadata: Metadata = {
  title: "New experiment · Runbook",
  description: "Define a bounded, reviewable investing experiment before an agent acts.",
};

export default function NewExperimentPage() {
  return <ExperimentBuilder />;
}
