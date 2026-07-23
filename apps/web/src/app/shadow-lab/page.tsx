import type { Metadata } from "next";
import { ShadowLab } from "@/components/shadow-lab";

export const metadata: Metadata = {
  title: "Shadow Process Lab · Runbook",
  description:
    "Recursive charter self-improvement theater. Synthetic curriculum, evaluateProposal tickets, deterministic refine rules. Process control quality only — not investment skill. No capital, no broker, no credentials.",
};

export default function ShadowLabPage() {
  return <ShadowLab />;
}
