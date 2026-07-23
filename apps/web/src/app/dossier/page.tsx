import type { Metadata } from "next";
import { DossierStatus } from "@/components/dossier-status";

export const metadata: Metadata = {
  title: "Dossier status · Runbook",
  description:
    "Honest Pre-Capital Control Dossier V2 status board: 31 cases, 6 evaluated, 2 process-bridged (000, 003), 25 unrun. Architecture evidence only — not buyer-ready, not a safety score.",
};

export default function DossierPage() {
  return <DossierStatus />;
}
