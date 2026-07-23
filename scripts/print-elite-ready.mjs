#!/usr/bin/env node
/**
 * First-run operator banner after setup:elite.
 * Prints the next commands operators actually use.
 * No network, no credentials, no broker.
 */

const mcpAdd =
  'codex mcp add runbook -- node "$PWD/packages/mcp/dist/server.js"';

console.log(`Runbook elite ready
  demo:elite
  web: pnpm --filter @runbook/web dev
  mcp: ${mcpAdd}
  process health: multi-axis buildProcessHealthReport (processClean) — not a composite safety grade`);
