---
status: accepted
---
# The runner drives the daily sequence; the local model only writes, over direct HTTP by default

A four-model design panel (see `docs/design/panel-verdict.md`) unanimously recommended that a plain TypeScript runner sequence the fixed daily steps and that the local model only write. The agent-as-driver design in ADR-0001 was the account owner's explicit choice; on 2026-09-20 they accepted this design instead, with the amendment below, and ADR-0001 is superseded.

**Amendment (2026-09-20):** the default writer is a direct HTTP call to the local model server with a JSON schema, not the qwen code harness. Measured on the same prompt, the harness took 600 s and timed out where HTTP took 152 s, and 2 of 23 harness attempts failed while HTTP answered every time (`docs/design/review-2026-09-19.md`). qwen code stays installed as the maintenance console and as an optional writer (`WRITER_MODEL=qwen`) with HTTP as its fallback. The merge keeps qwen code in the loop as the harness tuned for the model: the write step spawns `qwen` headless with `--max-tool-calls 0`, `--json-schema`, `--max-wall-time` and `--safe-mode` (no context files, skills, hooks or extensions), so it formats prompts and enforces structured output but cannot act. With zero tool calls allowed there is nothing for a sandbox to contain, so none is used; measured, safe mode halves the time per call. An OpenAI-compatible HTTP adapter sits behind the same seam as a fallback.

## Consequences

- The gate no longer tests agent orchestration; it tests completion and draft validity.
- If accepted, ADR-0001 becomes superseded by this record.
