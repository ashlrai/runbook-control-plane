import type { Metadata } from "next";
import { ContentDesk } from "@/components/content-desk";

export const metadata: Metadata = {
  title: "Publish desk · Runbook",
  description: "Turn owned experiment records into honest, human-reviewed lab notes.",
};

export default function ContentPage() {
  return <ContentDesk />;
}
