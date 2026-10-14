# Goal-Backward Verification

Start with the requested outcome and trace the evidence needed to establish it.

1. **Exists:** locate the owner that implements the requested behavior.
2. **Substantive:** read its actual behavior, including error and empty-input
   paths. TODO markers or empty returns are search leads, not proof of a stub;
   they can be legitimate parts of the contract.
3. **Wired:** trace the required entry point through callers, registration,
   authorization, and consumers. Check only surfaces required by the request.
4. **Observed:** use the test or live boundary appropriate to the claim. Static
   wiring alone does not prove a user workflow or provider integration works.

Report a missing or incomplete path with concrete evidence and practical impact.
A function existing, being long, or lacking TODO markers does not verify a goal.
Evidence reuse follows `completion-verification.md`.
