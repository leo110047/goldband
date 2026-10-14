# Security Boundaries

## Baseline Policy

Security checks belong at the boundary that owns the data, identity, permission,
or side effect. Localhost, child processes, SDK callbacks, tool output, and
machine-generated content are not trusted merely because they are local or
structured.

## Required Behavior

- Validate untrusted input with a schema or typed parser before it changes
  state, reaches a privileged API, becomes evidence, or causes a side effect.
- Authenticate identity and authorize the requested action separately. Missing,
  unknown, expired, malformed, or unsupported values fail closed.
- Preserve the permission authority of the owning runtime or platform. Do not
  bypass approval, widen allowed decisions, or infer permission from a tool name
  without validating the correlated operation and target.
- Add only controls matched to a threat present at that boundary; code without
  the threat gets no control for it.
- Do not hardcode credentials, tokens, passwords, private keys, or authorization
  headers. Load required secrets from an approved environment or secret manager,
  fail clearly when they are missing, and never print them in errors or logs.
- Persist only the external or model-generated data required by the product
  contract. Validate and redact it first; if raw payload retention is truly
  required, define access control, retention, and deletion policy explicitly.
- Error responses must not expose stack traces, queries, filesystem paths,
  credentials, or internal authorization details to an untrusted caller.

## Security Response

When a security issue is found:

1. Stop the unsafe operation and state the affected boundary.
2. Report severity, concrete evidence, exposed data or authority, and current
   containment status.
3. Fix critical issues before continuing adjacent feature work.
4. Rotate any credential that may have been exposed.
5. Search for the same failure pattern at sibling boundaries and add a test or
   gate that would catch the regression.
