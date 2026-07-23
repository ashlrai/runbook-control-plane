/**
 * Dual-eval: ledger charter vs session charter binding.
 * Process-layer only — never a broker gateway.
 */

export type CharterBindingEnforcement = "off" | "warn" | "fail-closed";

export type SessionCharterBinding =
  | "no-session"
  | "no-session-charter"
  | "matched-allowed"
  | "matched-denied"
  | "mismatch-session-denies"
  | "mismatch-session-allows";

export type CharterDualEvalInput = Readonly<{
  ledgerAllowed: boolean;
  /** Whether a control-plane session was resolved for this preflight. */
  sessionPresent: boolean;
  sessionHasCharter: boolean;
  /** Result of evaluateProposal(session.charter, proposal) when charter exists. */
  sessionAllowed?: boolean;
  enforcement: CharterBindingEnforcement;
}>;

export type CharterDualEvalResult = Readonly<{
  sessionCharterBinding: SessionCharterBinding;
  ledgerAllowed: boolean;
  sessionPolicyAllowed?: boolean;
  /**
   * Effective process allow after applying charterBindingEnforcement.
   * Under fail-closed: ledgerAllowed AND sessionAllowed (missing charter → deny).
   * Under warn/off: equals ledgerAllowed.
   * Still not a hard broker gateway — host may bypass Runbook.
   */
  allowed: boolean;
  /** True when fail-closed flipped an otherwise-ledger-allowed proposal to process deny. */
  processDeniedBySession: boolean;
  charterBindingEnforcement: CharterBindingEnforcement;
  /** Extra text to append to the advisory preflight warning. */
  warningSuffix: string;
}>;

/**
 * Resolve ledger vs session charter dual-eval and optional process-layer deny.
 */
export function resolveCharterDualEval(input: CharterDualEvalInput): CharterDualEvalResult {
  const enforcement = input.enforcement;
  const ledgerAllowed = input.ledgerAllowed;

  if (!input.sessionPresent || enforcement === "off") {
    return {
      sessionCharterBinding: "no-session",
      ledgerAllowed,
      allowed: ledgerAllowed,
      processDeniedBySession: false,
      charterBindingEnforcement: enforcement,
      warningSuffix: "",
    };
  }

  if (!input.sessionHasCharter) {
    const processDeniedBySession = enforcement === "fail-closed" && ledgerAllowed;
    return {
      sessionCharterBinding: "no-session-charter",
      ledgerAllowed,
      allowed: enforcement === "fail-closed" ? false : ledgerAllowed,
      processDeniedBySession,
      charterBindingEnforcement: enforcement,
      warningSuffix:
        enforcement === "fail-closed"
          ? " Active session has no charter under fail-closed charter binding — process denies. Still not a broker gateway."
          : "",
    };
  }

  const sessionAllowed = input.sessionAllowed === true;
  let sessionCharterBinding: SessionCharterBinding;
  if (sessionAllowed === ledgerAllowed) {
    sessionCharterBinding = sessionAllowed ? "matched-allowed" : "matched-denied";
  } else if (!sessionAllowed && ledgerAllowed) {
    sessionCharterBinding = "mismatch-session-denies";
  } else {
    sessionCharterBinding = "mismatch-session-allows";
  }

  let allowed = ledgerAllowed;
  let processDeniedBySession = false;
  if (enforcement === "fail-closed" && !sessionAllowed) {
    processDeniedBySession = ledgerAllowed;
    allowed = false;
  }

  let warningSuffix = "";
  if (sessionCharterBinding === "mismatch-session-denies") {
    warningSuffix =
      enforcement === "fail-closed"
        ? " Session charter DENIES this proposal (fail-closed process deny). Still not a broker gateway."
        : " Session charter would DENY this proposal while the experiment ledger charter allowed it — treat as process risk.";
  } else if (processDeniedBySession) {
    warningSuffix =
      " Session charter DENIES this proposal (fail-closed process deny). Still not a broker gateway.";
  }

  return {
    sessionCharterBinding,
    ledgerAllowed,
    sessionPolicyAllowed: sessionAllowed,
    allowed,
    processDeniedBySession,
    charterBindingEnforcement: enforcement,
    warningSuffix,
  };
}
