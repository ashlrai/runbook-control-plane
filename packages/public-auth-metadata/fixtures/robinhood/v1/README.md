# Frozen Robinhood public OAuth metadata fixtures

The four top-level `.raw.json` files are exact public response bodies captured
without credentials at `2026-07-22T09:04:27Z`. Each retains its final LF. The
`expected/` directory is generated offline from those bytes and fixed HTTP
evidence declarations; its projections, observations, bundle, and manifest are
exact JCS with no transport newline. `SHA256SUMS` covers every generated member
except itself.

Optional response-header values not retained during the initial probe are
represented as `null`. Banking's observed `Vary: Accept-Encoding` is retained.
The evidence records provider-published discovery output only. It does not
establish OAuth conformance, runtime availability, authenticated capabilities,
privileges, approval enforcement, entitlement, provider consent, or commercial
rights.

Regenerate only into a new directory and byte-compare the complete file set.
Live network access is never part of fixture generation or CI.
