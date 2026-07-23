import type { Metadata } from "next";
import { ProcessTheater } from "@/components/process-theater";
import { SITE_ORIGIN } from "@/lib/site";

export const metadata: Metadata = {
  title: "Process Theater · Runbook",
  description:
    "Hosted lab process theater: browser sessions, inventory pin, shadow generations, dual-eval demo, and surface version notes. Process evidence only — no live capital, no broker credentials, no composite safety score.",
  alternates: { canonical: `${SITE_ORIGIN}/theater` },
};

export default function TheaterPage() {
  return <ProcessTheater />;
}
