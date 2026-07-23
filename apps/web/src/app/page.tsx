import type { Metadata } from "next";
import { ProductMap } from "@/components/product-map";

export const metadata: Metadata = {
  title: "Product map · Runbook",
  description:
    "Three doors for builders: break the agent safely, verify portable evidence, and record a human-owned experiment. Local-first, no credentials, no composite safety score.",
};

export default function Home() {
  return <ProductMap />;
}
