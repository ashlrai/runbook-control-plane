import type { Metadata } from "next";
import { ProofCapsulePage } from "@/components/proof-capsule-page";

export const metadata: Metadata = {
  title: "Proof Capsule · Runbook",
  description:
    "Inspect a synthetic proof model, explore the current local metadata verifier, and study Runbook's draft open capsule format for bounded agentic investing experiments.",
};

export default function ProofCapsuleRoute() {
  return <ProofCapsulePage />;
}
