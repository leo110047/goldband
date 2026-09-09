# Choosing Evidence

| Claim | Evidence to inspect |
| --- | --- |
| A file or configuration exists | The actual path and relevant contents |
| A function or API has a contract | Its authoritative implementation/schema and relevant callers |
| A change fixes a defect | The failing input exercised on the changed execution path |
| An integration works | The actual producer/consumer boundary in the claimed environment |
| A command or installation succeeded | Exit result plus the output or installed state required by the task |

Use search to locate owners, then read enough context to establish the claim.
A source declaration or dependency entry does not establish runtime wiring.
Read tests when they clarify the contract; executing every test is not required
to describe a static definition.

For evidence reuse and completion, see `completion-verification.md`.
