# Misleading Evidence Patterns

- An installed package or declared route does not prove it is used. Trace the
  caller or registration when the claim depends on integration.
- A successful mock does not prove the real service accepts the request or
  preserves permissions. Exercise the actual boundary before making that claim.
- A test can pass without reaching the changed code. Check its inputs, wiring,
  and assertion against the defect it is supposed to catch.
- A path, method, option, or version remembered from another project may not
  exist here. Check its authoritative source before recommending it.
- An agent's confident summary is not an independent result. Inspect the
  evidence; report its limitations rather than copying the verdict.

Words such as "probably" are not themselves defects. Clearly distinguish a
hypothesis from a verified result instead of policing conversational phrases.
