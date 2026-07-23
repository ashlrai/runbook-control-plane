import type { Metadata } from "next";
import { ProductMap } from "@/components/product-map";

export const metadata: Metadata = {
  title: "Product map · Runbook",
  description:
    "Hosted process lab: control-plane story, session spine, safety bench, portable evidence, and human-owned experiments. Browser-local, no credentials, no composite safety score.",
};

export default function Home() {
  return <ProductMap />;
}
