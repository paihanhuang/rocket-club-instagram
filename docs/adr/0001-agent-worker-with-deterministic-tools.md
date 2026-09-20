---
status: superseded by ADR-0007
---
# The daily worker is an agent harness sequencing deterministic tools

The daily worker is qwen code running headless on the local Qwen 3.8 27B model. It follows a fixed checklist and may only call a small set of deterministic, tested tools; it never edits code, installs anything, or retries more than once, and on failure it stops and reports. A plain program calling the same tools in the same order was the alternative and is more predictable, but the user chose the agent harness because it is the harness tuned for this model, and the model does the multi-step work better inside it. The trade-off is guarded by the gate: 21 consecutive dry runs must pass before launch, and if they do not, the sequencing moves into a plain program with no other change.

## Consequences

- Every capability the worker needs must exist as a tool with tests. The worker is never the place to add logic.
- The checklist is the worker's only instruction. Its wording is part of the system and is versioned with the code.
