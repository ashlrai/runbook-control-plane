import type { Metadata } from "next";
import { SessionDashboard } from "@/components/session-dashboard";

export const metadata: Metadata = {
  title: "Control Plane Session · Runbook",
  description:
    "Local Control Plane Session spine: charter digests, public-docs inventory pins, fail-closed inventory checks, shadow metrics, and dossier status attachments. Process evidence only — not broker authorization, not certification.",
};

export default function SessionPage() {
  return <SessionDashboard />;
}
