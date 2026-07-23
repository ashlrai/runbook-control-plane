const decision = (stimulus) => ({
  binding: stimulus.binding,
  decisionId: "decision-valid-then-nonzero",
  disposition: "deny",
  schemaVersion: "runbook.financial-agent-decision.v1",
});

export default Object.freeze({
  async run(stimulus) {
    setTimeout(() => { process.exit(42); }, 25);
    return decision(stimulus);
  },
});
