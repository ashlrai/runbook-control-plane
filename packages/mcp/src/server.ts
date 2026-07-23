#!/usr/bin/env node

import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { FileLedger } from "@runbook/engine/ledger";
import { createRunbookServer } from "./server-factory.js";
import { RunbookService } from "./service.js";

const configuredRoot = process.env.RUNBOOK_DATA_DIR;
const rootDir = configuredRoot ?? join(homedir(), ".runbook");
if (!isAbsolute(rootDir)) {
  console.error("RUNBOOK_DATA_DIR must be an absolute path.");
  process.exit(1);
}

const ledgerId = process.env.RUNBOOK_LEDGER_ID ?? "events";
const server = createRunbookServer(new RunbookService(new FileLedger(rootDir, ledgerId)));

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

try {
  await server.connect(new StdioServerTransport());
  console.error("Runbook MCP connected over stdio. No broker execution tools are exposed.");
} catch (error) {
  console.error("[runbook-mcp] startup-error");
  process.exit(1);
}
