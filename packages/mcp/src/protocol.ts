/**
 * Shared MCP result and structured error envelope for agent-safe failures.
 * Never include paths, env values, credential material, or stack traces.
 */

export const MCP_ERROR_SCHEMA = "runbook.mcp-error.v1" as const;

export type McpErrorCode =
  | "charter.not-found"
  | "preflight.not-found"
  | "approval.hard-control-failed"
  | "approval.actor-not-human"
  | "ledger.idempotency-conflict"
  | "input.invalid"
  | "fixture.unknown"
  | "path.invalid"
  | "path.size-limit"
  | "tool.failed-safely";

export type McpErrorBody = {
  schemaVersion: typeof MCP_ERROR_SCHEMA;
  code: McpErrorCode;
  message: string;
  retryable: boolean;
  brokerEffect: false;
  assurance: string;
  limitations: string[];
};

export type McpToolSuccess = {
  content: [{ type: "text"; text: string }];
  structuredContent: Record<string, unknown>;
};

export type McpToolError = {
  /**
   * Human-readable message only in content[0].
   * Full machine envelope is JSON in content[1] when dual-part,
   * or solely as JSON when preferJsonContent is used.
   *
   * Note: MCP TypeScript Client validates structuredContent against the
   * success outputSchema even on isError — so we intentionally omit
   * structuredContent on errors and put the envelope in content text JSON.
   */
  content: Array<{ type: "text"; text: string }>;
  isError: true;
  /** Present for in-process callers/tests; stripped or ignored by strict clients. */
  _runbookError?: McpErrorBody;
};

const DEFAULT_LIMITATIONS = [
  "advisory-only",
  "no-broker-execution",
  "no-credential-handling",
  "local-process-only",
] as const;

export function toolSuccess(output: Record<string, unknown>): McpToolSuccess {
  return {
    content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
    structuredContent: output,
  };
}

export function toolError(
  code: McpErrorCode,
  message: string,
  options?: {
    retryable?: boolean;
    assurance?: string;
    limitations?: string[];
  },
): McpToolError {
  const body: McpErrorBody = {
    schemaVersion: MCP_ERROR_SCHEMA,
    code,
    message,
    retryable: options?.retryable ?? false,
    brokerEffect: false,
    assurance: options?.assurance ?? "local-tool-failure-only",
    limitations: options?.limitations ?? [...DEFAULT_LIMITATIONS],
  };
  // Dual content: human message first (legacy tests + UX), machine envelope second.
  // Do not set structuredContent — Client.callTool would validate it against success schemas.
  return {
    content: [
      { type: "text", text: message },
      { type: "text", text: JSON.stringify(body) },
    ],
    isError: true,
    _runbookError: body,
  };
}

/** Parse machine error envelope from an MCP tool error result. */
export function parseToolErrorContent(result: {
  content?: Array<{ type: string; text?: string }>;
  _runbookError?: McpErrorBody;
}): McpErrorBody | null {
  if (result._runbookError?.schemaVersion === MCP_ERROR_SCHEMA) {
    return result._runbookError;
  }
  for (const part of result.content ?? []) {
    if (part.type !== "text" || !part.text) continue;
    try {
      const parsed = JSON.parse(part.text) as McpErrorBody;
      if (parsed?.schemaVersion === MCP_ERROR_SCHEMA && typeof parsed.code === "string") {
        return parsed;
      }
    } catch {
      // not JSON
    }
  }
  return null;
}

/** Map known service/engine throws to stable codes without leaking IDs or paths. */
export function mapServiceError(error: unknown): McpToolError {
  if (error instanceof Error) {
    if (error.name === "FixtureCatalogError") {
      return toolError(
        "fixture.unknown",
        "Unknown or mismatched fixture identifier.",
      );
    }
    if (error.name === "OwnedFileError") {
      if (error.message === "path.size-limit") {
        return toolError("path.size-limit", "Local file exceeds the allowed size limit.");
      }
      return toolError("path.invalid", "Local path is invalid, disallowed, or unreadable.");
    }
  }

  const raw = error instanceof Error ? error.message : "";

  if (raw === "fixture.unknown" || raw === "fixture.hash-mismatch") {
    return toolError("fixture.unknown", "Unknown or mismatched fixture identifier.");
  }
  if (raw === "path.size-limit") {
    return toolError("path.size-limit", "Local file exceeds the allowed size limit.");
  }
  if (raw === "path.invalid") {
    return toolError("path.invalid", "Local path is invalid, disallowed, or unreadable.");
  }

  if (raw === "Cannot record an approval for a proposal that failed a hard policy control.") {
    return toolError(
      "approval.hard-control-failed",
      "Approval rejected: the preflight failed a hard policy control.",
      { assurance: "caller-owned-observation-only" },
    );
  }
  if (raw === "Only a caller-asserted human actor can record an approval decision.") {
    return toolError(
      "approval.actor-not-human",
      "Approval rejected: only a caller-asserted human actor can record a decision.",
      { assurance: "caller-owned-observation-only" },
    );
  }
  if (raw.startsWith("No preflight record found for proposal ")) {
    return toolError(
      "preflight.not-found",
      "Approval rejected: no matching preflight evidence exists.",
      { assurance: "caller-owned-observation-only" },
    );
  }
  if (raw.startsWith("No active charter found for experiment ")) {
    return toolError(
      "charter.not-found",
      "Runbook could not find an active charter.",
      { assurance: "local-ledger-only" },
    );
  }
  if (raw.startsWith("Idempotency conflict for key ")) {
    return toolError(
      "ledger.idempotency-conflict",
      "Runbook refused a conflicting idempotency key.",
      { retryable: false, assurance: "local-ledger-only" },
    );
  }

  return toolError(
    "tool.failed-safely",
    "Runbook tool failed safely. Review local server logs.",
  );
}

export function withToolErrors<TInput extends Record<string, unknown>>(
  handler: (input: TInput) => Promise<Record<string, unknown>>,
) {
  return async (input: TInput): Promise<McpToolSuccess | McpToolError> => {
    try {
      return toolSuccess(await handler(input));
    } catch (error) {
      console.error("[runbook-mcp] tool-error");
      return mapServiceError(error);
    }
  };
}
