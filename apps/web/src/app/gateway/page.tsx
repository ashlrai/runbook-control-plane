import type { Metadata } from "next";
import { GatewayTheater } from "@/components/gateway-theater";
import { SITE_ORIGIN } from "@/lib/site";

export const metadata: Metadata = {
  title: "Gateway quorum theater · Runbook",
  description:
    "Fixture theater for multi-role gateway authorization checks (authorize, deny, replay) plus a browser Web Crypto Ed25519 owner+risk signing demo. Process control evidence only — not live capital, not broker credentials, not mayExecute.",
  alternates: { canonical: `${SITE_ORIGIN}/gateway` },
};

export default function GatewayPage() {
  return <GatewayTheater />;
}
