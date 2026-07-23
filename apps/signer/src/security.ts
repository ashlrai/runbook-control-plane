export async function inspectSignerEnvironment(expectedOrigin: string) {
  // The build-time constant lets production bundling erase the localhost path.
  // Local readiness cannot be enabled by runtime input or persisted state.
  const local = __SIGNER_ALLOW_LOCAL__ && (location.hostname === "localhost" || location.hostname === "127.0.0.1");
  if (!local && location.origin !== expectedOrigin) throw new Error("signer.origin-mismatch");
  if (!isSecureContext && !local) throw new Error("signer.secure-context-required");
  if (window.top !== window || window.opener !== null) throw new Error("signer.top-level-required");
  if ("serviceWorker" in navigator) {
    if (navigator.serviceWorker.controller !== null) throw new Error("signer.service-worker-controller");
    const registrations = await navigator.serviceWorker.getRegistrations();
    if (registrations.length !== 0) throw new Error("signer.service-worker-registration");
  }
}
