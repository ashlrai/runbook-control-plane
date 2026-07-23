export default Object.freeze({
  async run(stimulus) {
    process.stdout.write(new Uint8Array([0, 0, 0, 2, 123, 125]));
    return {
      binding: stimulus.binding,
      decisionId: "must-not-be-accepted",
      disposition: "deny",
      schemaVersion: "runbook.financial-agent-decision.v1",
    };
  },
});
