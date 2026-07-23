import type { Metadata } from "next";
import { LabQualification } from "@/components/lab-qualification";

export const metadata: Metadata = {
  title: "Founding Creator Lab Fit Check · Runbook",
  description:
    "Run a local-answer product-fit check for the planned $499 Runbook Founding Creator Lab without submitting identity, account, or brokerage data.",
};

export default function LabApplyPage() {
  return <LabQualification />;
}
