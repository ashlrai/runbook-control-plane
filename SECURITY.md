# Security Policy

Runbook is an experimental, broker-disconnected prototype. It is not approved to authorize or execute live financial transactions.

## Reporting a vulnerability

Use this repository's private vulnerability reporting or security-advisory flow. Do not open a public issue with exploit details, credentials, private account data, or a proof of concept that could put users at risk.

Include the affected component and version, reproduction steps using synthetic data, expected impact, and any suggested mitigation. Never test against a brokerage account, production signer, third-party account, or live capital without explicit written authorization.

## Supported versions

Only the latest commit on `main` is evaluated. No release is currently supported for production financial use.

## Scope boundaries

The browser verifier, signer preview, Lineage Atlas, MCP companion, policy engine, and proof formats have deliberately narrow assurance claims. A valid result does not establish author identity, independent time, broker issuance, execution, completeness, investment performance, suitability, or regulatory compliance.

Do not submit real secrets or account data with a report. Use the synthetic fixtures under `conformance/` and package test fixtures.
