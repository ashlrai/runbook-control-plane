export const PUBLIC_AUTH_METADATA_PROFILE = "runbook.robinhood-mcp-public-oauth.v1" as const;
export const PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID = "robinhood-public-auth-metadata-v1" as const;
export const PUBLIC_AUTH_METADATA_OBSERVATION_SCHEMA = "runbook.public-auth-metadata-observation.v1" as const;
export const PUBLIC_AUTH_METADATA_BUNDLE_SCHEMA = "runbook.public-auth-metadata-bundle.v1" as const;
export const PUBLIC_AUTH_METADATA_DIFF_SCHEMA = "runbook.public-auth-metadata-diff.v1" as const;

export const PUBLIC_AUTH_METADATA_SOURCE_IDS = Object.freeze([
  "robinhood-banking-authorization-server",
  "robinhood-banking-protected-resource",
  "robinhood-trading-authorization-server",
  "robinhood-trading-protected-resource",
] as const);

export type PublicAuthMetadataSourceId = (typeof PUBLIC_AUTH_METADATA_SOURCE_IDS)[number];
export type PublicAuthMetadataDocumentKind =
  | "authorization-server-metadata"
  | "protected-resource-metadata";

export const PUBLIC_AUTH_METADATA_WATCHED_FIELDS = Object.freeze([
  "authorization-endpoint",
  "authorization-servers",
  "bearer-methods-supported",
  "code-challenge-methods-supported",
  "field-set",
  "grant-types-supported",
  "issuer",
  "registration-endpoint",
  "resource",
  "response-types-supported",
  "scopes-supported",
  "token-endpoint",
  "token-endpoint-auth-methods-supported",
  "unknown-field-values",
] as const);

export type PublicAuthMetadataWatchedField =
  (typeof PUBLIC_AUTH_METADATA_WATCHED_FIELDS)[number];

export const PUBLIC_AUTH_METADATA_PROFILE_FINDINGS = Object.freeze([
  "authorization-endpoint-unexpected",
  "authorization-server-mismatch",
  "bearer-method-set-unexpected",
  "grant-type-set-unexpected",
  "issuer-mismatch",
  "metadata-array-duplicate",
  "metadata-field-missing",
  "metadata-field-type-invalid",
  "metadata-field-unknown",
  "pkce-method-set-unexpected",
  "registration-endpoint-unexpected",
  "resource-mismatch",
  "response-type-set-unexpected",
  "scope-label-set-unexpected",
  "token-auth-method-set-unexpected",
  "token-endpoint-unexpected",
  "uri-unallowlisted",
] as const);

export type PublicAuthMetadataProfileFinding =
  (typeof PUBLIC_AUTH_METADATA_PROFILE_FINDINGS)[number];

export const PUBLIC_AUTH_METADATA_LIMITATIONS = Object.freeze([
  "candidate-capture-does-not-promote-a-baseline",
  "closed-profile-rejects-unreviewed-oauth-extensions",
  "does-not-authorize-account-card-trade-purchase-or-capital-access",
  "does-not-authorize-registration-authentication-token-or-mcp-use",
  "does-not-grant-provider-consent-or-commercial-use-rights",
  "does-not-prove-authenticated-tools-privileges-or-entitlements",
  "does-not-prove-runtime-availability-or-approval-enforcement",
  "public-self-asserted-discovery-metadata-only",
  "time-is-declared-not-independently-trusted",
] as const);

export type PublicAuthMetadataSourceDefinition = Readonly<{
  documentKind: PublicAuthMetadataDocumentKind;
  requestedUrl: string;
  sourceId: PublicAuthMetadataSourceId;
  sourceSeriesId: typeof PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID;
}>;

export type PublicAuthMetadataHttpEvidence = Readonly<{
  cacheControl: string | null;
  contentEncoding: null;
  contentLength: number;
  contentType: "application/json";
  etag: string | null;
  lastModified: string | null;
  locationPresent: false;
  serverDate: string | null;
  setCookiePresent: false;
  status: 200;
  vary: string | null;
}>;

export type PublicAuthMetadataSemanticDigest = Readonly<{
  fieldCode: PublicAuthMetadataWatchedField;
  sha256: string;
}>;

export type PublicAuthMetadataObservationV1 = Readonly<{
  documentKind: PublicAuthMetadataDocumentKind;
  findings: readonly PublicAuthMetadataProfileFinding[];
  http: PublicAuthMetadataHttpEvidence;
  limitations: typeof PUBLIC_AUTH_METADATA_LIMITATIONS;
  profileValid: boolean;
  profileVersion: typeof PUBLIC_AUTH_METADATA_PROFILE;
  projectionSha256: string;
  requestedUrl: string;
  responseBody: Readonly<{ byteLength: number; sha256: string }>;
  retrievedAtDeclared: string;
  schemaVersion: typeof PUBLIC_AUTH_METADATA_OBSERVATION_SCHEMA;
  semanticDigests: readonly PublicAuthMetadataSemanticDigest[];
  sourceId: PublicAuthMetadataSourceId;
  sourceSeriesId: typeof PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID;
}>;

export type PublicAuthMetadataBundleBinding = Readonly<{
  observationSha256: string;
  profileValid: boolean;
  projectionSha256: string;
  retrievedAtDeclared: string;
  sourceId: PublicAuthMetadataSourceId;
}>;

export type PublicAuthMetadataBundleV1 = Readonly<{
  bindings: readonly PublicAuthMetadataBundleBinding[];
  limitations: typeof PUBLIC_AUTH_METADATA_LIMITATIONS;
  previousAdmittedBundleSha256: string | null;
  profileValid: boolean;
  profileVersion: typeof PUBLIC_AUTH_METADATA_PROFILE;
  registryRevision: number;
  retrievalWindow: Readonly<{
    durationMilliseconds: number;
    firstRetrievedAtDeclared: string;
    lastRetrievedAtDeclared: string;
  }>;
  schemaVersion: typeof PUBLIC_AUTH_METADATA_BUNDLE_SCHEMA;
  sourceSeriesId: typeof PUBLIC_AUTH_METADATA_SOURCE_SERIES_ID;
}>;

export type PublicAuthMetadataDiffChange = Readonly<{
  afterSha256: string;
  beforeSha256: string;
  fieldCode: PublicAuthMetadataWatchedField;
  findingCodes: readonly ["metadata-field-changed"];
}>;

export type PublicAuthMetadataDiffV1 = Readonly<{
  baselineHttpSha256: string;
  baselineObservationSha256: string;
  baselineProjectionSha256: string;
  baselineResponseBodySha256: string;
  candidateFindings: readonly PublicAuthMetadataProfileFinding[];
  candidateHttpSha256: string;
  candidateObservationSha256: string;
  candidateProjectionSha256: string;
  candidateResponseBodySha256: string;
  changes: readonly PublicAuthMetadataDiffChange[];
  disposition: "invalid-candidate" | "no-change" | "review-required";
  headerChanged: boolean;
  limitations: typeof PUBLIC_AUTH_METADATA_LIMITATIONS;
  profileVersion: typeof PUBLIC_AUTH_METADATA_PROFILE;
  rawBodyChanged: boolean;
  schemaVersion: typeof PUBLIC_AUTH_METADATA_DIFF_SCHEMA;
  semanticChanged: boolean;
  sourceId: PublicAuthMetadataSourceId;
}>;

export type BuiltPublicAuthMetadataObservation = Readonly<{
  observation: PublicAuthMetadataObservationV1;
  observationBytes: Uint8Array;
  projectionBytes: Uint8Array;
}>;
