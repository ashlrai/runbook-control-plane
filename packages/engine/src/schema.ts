import { z } from "zod";

export const instrumentSchema = z.enum(["equity", "option", "crypto"]);
export const sideSchema = z.enum(["buy", "sell"]);

export const importEventSchema = z.object({
  schemaVersion: z.literal("runbook.event.v1"),
  source: z.enum(["robinhood-mcp", "robinhood-csv", "manual", "alpaca-paper"]),
  recordedAt: z.iso.datetime(),
  accountAlias: z.string().trim().min(1).max(80),
  event: z.object({
    type: z.enum(["proposal", "approval", "order", "fill", "cancel", "review"]),
    symbol: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()),
    side: sideSchema.optional(),
    quantity: z.number().finite().nonnegative().optional(),
    notional: z.number().finite().nonnegative().optional(),
    brokerEventId: z.string().trim().max(160).optional(),
    note: z.string().trim().max(2_000).optional(),
  }).strict(),
}).strict();

export type ImportEvent = z.infer<typeof importEventSchema>;

export const riskPolicySchema = z
  .object({
    capitalBudget: z.number().finite().positive().max(100_000_000),
    cashReserve: z.number().finite().nonnegative().max(100_000_000),
    maxPositionPercent: z.number().finite().positive().max(100),
    maxOrderNotional: z.number().finite().positive().max(100_000_000),
    maxDrawdownPercent: z.number().finite().positive().max(100),
    maxDailyTrades: z.number().int().positive().max(10_000),
    allowedInstruments: z.array(instrumentSchema).min(1),
    allowedSymbols: z.array(z.string().trim().min(1).max(20)).default([]),
    deniedSymbols: z.array(z.string().trim().min(1).max(20)).default([]),
    approvalRequired: z.boolean(),
  })
  .strict()
  .superRefine((policy, context) => {
    if (policy.cashReserve >= policy.capitalBudget) {
      context.addIssue({
        code: "custom",
        path: ["cashReserve"],
        message: "Cash reserve must be smaller than the capital budget.",
      });
    }
    if (policy.maxOrderNotional > policy.capitalBudget - policy.cashReserve) {
      context.addIssue({
        code: "custom",
        path: ["maxOrderNotional"],
        message: "Maximum order cannot exceed deployable capital.",
      });
    }
    const denied = new Set(policy.deniedSymbols.map((symbol) => symbol.toUpperCase()));
    for (const symbol of policy.allowedSymbols) {
      if (denied.has(symbol.toUpperCase())) {
        context.addIssue({
          code: "custom",
          path: ["allowedSymbols"],
          message: `${symbol.toUpperCase()} cannot be both allowed and denied.`,
        });
      }
    }
  });

export type RiskPolicy = z.infer<typeof riskPolicySchema>;

export const tradeProposalSchema = z.object({
  proposalId: z.string().trim().min(1).max(120),
  experimentId: z.string().trim().min(1).max(120),
  symbol: z.string().trim().min(1).max(20).transform((value) => value.toUpperCase()),
  instrument: instrumentSchema,
  side: sideSchema,
  notional: z.number().finite().positive(),
  projectedPositionNotional: z.number().finite().nonnegative(),
  dailyTradesAfter: z.number().int().nonnegative(),
  currentDrawdownPercent: z.number().finite().nonnegative(),
  hasThesis: z.boolean(),
  hasInvalidation: z.boolean(),
  evidenceSourceCount: z.number().int().nonnegative(),
}).strict();

export type TradeProposal = z.infer<typeof tradeProposalSchema>;

export const policyCheckSchema = z.object({
  id: z.string(),
  label: z.string(),
  passed: z.boolean(),
  severity: z.enum(["hard", "advisory"]),
  detail: z.string(),
}).strict();

export type PolicyCheck = z.infer<typeof policyCheckSchema>;

export const ledgerEventTypeSchema = z.enum([
  "experiment.created",
  "charter.activated",
  "proposal.recorded",
  "preflight.completed",
  "approval.recorded",
  "execution.recorded",
  "review.recorded",
  "experiment.closed",
]);

export type LedgerEventType = z.infer<typeof ledgerEventTypeSchema>;

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const ledgerActorSchema = z.object({
  type: z.enum(["human", "agent", "system", "broker-import"]),
  id: z.string().trim().min(1).max(120),
}).strict();

export type LedgerActor = z.infer<typeof ledgerActorSchema>;

export const ledgerEventInputSchema = z.object({
  experimentId: z.string().trim().min(1).max(120),
  type: ledgerEventTypeSchema,
  occurredAt: z.iso.datetime(),
  actor: ledgerActorSchema,
  idempotencyKey: z.string().trim().min(1).max(200),
  payload: z.record(z.string(), z.unknown()),
}).strict();

export type LedgerEventInput = Omit<
  z.infer<typeof ledgerEventInputSchema>,
  "payload"
> & { payload: Record<string, JsonValue> };

export type LedgerEvent = LedgerEventInput & {
  schemaVersion: "runbook.ledger.v1";
  sequence: number;
  eventId: string;
  recordedAt: string;
  previousHash: string;
  hash: string;
};

const publicExperimentIdSchema = z.string()
  .regex(/^RUN-[A-Za-z0-9_-]{1,115}$/, "Public experiment IDs must use the RUN- prefix and safe identifier characters.")
  .refine((value) => !/\d{9,}/.test(value), "Public experiment IDs cannot contain long numeric sequences.")
  .refine((value) => !/(?:account|password|secret|token|credential|session|cookie)/i.test(value), "Public experiment IDs cannot contain credential-like labels.");

export const publicSnapshotSchema = z.object({
  schemaVersion: z.literal("runbook.public-snapshot.v1"),
  generatedAt: z.iso.datetime(),
  experimentId: publicExperimentIdSchema,
  sourceLedger: z.object({
    validAtExport: z.literal(true),
    eventCount: z.number().int().nonnegative(),
    headHash: z.string().regex(/^[a-f0-9]{64}$/),
    assurance: z.literal("local-tamper-evidence-only"),
  }).strict(),
  projection: z.object({
    privacy: z.literal("metadata-only"),
    independentlyVerifiable: z.literal(false),
    note: z.literal("Filtered metadata projection; verify against the trusted source ledger head."),
  }).strict(),
  events: z.array(z.object({
    sequence: z.number().int().positive(),
    type: ledgerEventTypeSchema,
    occurredAt: z.iso.datetime(),
    hash: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).min(1).max(10_000),
}).strict().superRefine((snapshot, context) => {
  if (snapshot.sourceLedger.headHash === "0".repeat(64)) {
    context.addIssue({ code: "custom", path: ["sourceLedger", "headHash"], message: "A nonempty exported ledger cannot report the genesis hash as its head." });
  }
  let previousSequence = 0;
  const hashes = new Set<string>();
  const generatedAt = Date.parse(snapshot.generatedAt);
  for (const [index, event] of snapshot.events.entries()) {
    if (event.sequence <= previousSequence) {
      context.addIssue({ code: "custom", path: ["events", index, "sequence"], message: "Event sequences must be unique and strictly increasing." });
    }
    previousSequence = event.sequence;
    if (hashes.has(event.hash)) {
      context.addIssue({ code: "custom", path: ["events", index, "hash"], message: "Event hashes must be unique within a snapshot." });
    }
    hashes.add(event.hash);
    if (Date.parse(event.occurredAt) > generatedAt) {
      context.addIssue({ code: "custom", path: ["events", index, "occurredAt"], message: "An event cannot occur after the snapshot was generated." });
    }
  }
  const finalEvent = snapshot.events.at(-1);
  if (finalEvent && finalEvent.sequence > snapshot.sourceLedger.eventCount) {
    context.addIssue({ code: "custom", path: ["sourceLedger", "eventCount"], message: "Source event count cannot be smaller than an exported global sequence." });
  }
  if (
    finalEvent &&
    finalEvent.sequence === snapshot.sourceLedger.eventCount &&
    finalEvent.hash !== snapshot.sourceLedger.headHash
  ) {
    context.addIssue({ code: "custom", path: ["sourceLedger", "headHash"], message: "The exported final global event must match the reported source head." });
  }
});

export type PublicSnapshot = z.infer<typeof publicSnapshotSchema>;
