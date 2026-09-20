---
status: proposed
---
# The runner drives the daily sequence; qwen code is the writer harness with tools disabled

A four-model design panel (see `docs/design/panel-verdict.md`) unanimously recommended that a plain TypeScript runner sequence the fixed daily steps and that the local model only write. The agent-as-driver design in ADR-0001 was the account owner's explicit choice, so this decision is proposed, not accepted, until they confirm. The merge keeps qwen code in the loop as the harness tuned for the model: the write step spawns `qwen` headless with `--max-tool-calls 0`, `--json-schema`, `--max-wall-time` and `--safe-mode` (no context files, skills, hooks or extensions), so it formats prompts and enforces structured output but cannot act. With zero tool calls allowed there is nothing for a sandbox to contain, so none is used; measured, safe mode halves the time per call. An OpenAI-compatible HTTP adapter sits behind the same seam as a fallback.

## Consequences

- The gate no longer tests agent orchestration; it tests completion and draft validity.
- If accepted, ADR-0001 becomes superseded by this record.
