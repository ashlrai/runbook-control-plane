import type { Metadata } from "next";
import { McpCockpit } from "@/components/mcp-cockpit";

export const metadata: Metadata = {
  title: "MCP cockpit · Runbook",
  description:
    "Install the local Runbook MCP companion, inspect all 44 tools (1 discovery + 6 ledger + 7 offline + 6 shadow + 13 session + 11 elite), walk the golden journey checklist, run fixture demos, and validate a public snapshot offline. No hard gateway. No live broker connection.",
};

export default function McpPage() {
  return <McpCockpit />;
}
