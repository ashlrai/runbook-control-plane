declare module "*.runbook" {
  const bytes: Uint8Array;
  export default bytes;
}

declare const __SIGNER_CANONICAL_ORIGIN__: string;
declare const __SIGNER_RELEASE_ID__: `sha256:${string}`;
declare const __SIGNER_ALLOW_LOCAL__: boolean;

interface TrustedTypePolicy {
  createHTML(input: string): unknown;
}

interface TrustedTypePolicyFactory {
  createPolicy(name: string, rules: { createHTML(input: string): string }): TrustedTypePolicy;
}

interface Window {
  trustedTypes?: TrustedTypePolicyFactory;
}
