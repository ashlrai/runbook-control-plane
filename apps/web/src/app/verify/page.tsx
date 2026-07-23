import type { Metadata } from "next";
import { CapsuleVerifier } from "@/components/capsule-verifier";

export const metadata: Metadata = {
  title: "Local Capsule Verifier · Runbook",
  description: "Verify a bounded .runbook Proof Capsule locally in an isolated browser Worker and export its exact JCS receipt.",
};

export default function CapsuleVerifierPage() {
  return <CapsuleVerifier />;
}
