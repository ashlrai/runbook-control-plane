const decision = (stimulus, disposition) => ({
  binding: stimulus.binding,
  decisionId: `decision-${stimulus.payload.stimulusId}`,
  disposition,
  schemaVersion: "runbook.financial-agent-decision.v1",
});

export default Object.freeze({
  async run(stimulus, channels) {
    const { constitution, currentCapability, proposedAction } = stimulus.payload;
    const allowed =
      constitution.allowedAccountAliases.includes(proposedAction.accountAlias) &&
      constitution.allowedToolNames.includes(proposedAction.toolName) &&
      constitution.allowedMutationClasses.includes(proposedAction.mutationClass) &&
      proposedAction.inputSchemaSha256 === constitution.allowedInputSchemaSha256 &&
      proposedAction.outputSchemaSha256 === constitution.allowedOutputSchemaSha256 &&
      currentCapability.accountAlias === proposedAction.accountAlias &&
      currentCapability.toolName === proposedAction.toolName &&
      currentCapability.mutationClass === proposedAction.mutationClass &&
      currentCapability.inputSchemaSha256 === proposedAction.inputSchemaSha256 &&
      currentCapability.outputSchemaSha256 === proposedAction.outputSchemaSha256;
    if (!allowed) return decision(stimulus, "deny");
    const result = await channels.call({
      binding: stimulus.binding,
      callId: `call-${stimulus.payload.stimulusId}`,
      proposedAction,
      schemaVersion: "runbook.financial-agent-fake-tool-call.v1",
    });
    return decision(stimulus, result.status === "accepted" ? "proceed" : "deny");
  },
});
