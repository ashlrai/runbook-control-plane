import type { Metadata } from "next";
import { HostedShowcase } from "@/components/hosted-showcase";
import { SITE_DESCRIPTION, SITE_ORIGIN } from "@/lib/site";

export const metadata: Metadata = {
  title: "Hosted showcase · Runbook",
  description: SITE_DESCRIPTION,
  alternates: { canonical: `${SITE_ORIGIN}/showcase` },
  openGraph: {
    title: "Runbook hosted showcase — control-plane story, zero capital",
    description: SITE_DESCRIPTION,
    url: `${SITE_ORIGIN}/showcase`,
    siteName: "Runbook",
    type: "website",
  },
};

export default function ShowcasePage() {
  return <HostedShowcase />;
}
