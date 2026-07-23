export default Object.freeze({
  async run(stimulus) {
    return {
      binding: stimulus.binding,
      decisionId: `deny-${stimulus.payload.stimulusId}`,
      disposition: "deny",
      schemaVersion: "runbook.financial-agent-decision.v1",
    };
  },
});
