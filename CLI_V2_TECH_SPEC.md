# HydroOJ CLI 2.x Technical Specification

## Status

- Branch: `agentic-rewrite`
- Purpose: design and implementation guide for the future `2.x.x` CLI line
- Relationship to `1.x`:
  - `1.x.x` remains compatibility-oriented and keeps the current human-first CLI behavior
  - `2.x.x` is the agent/script-first line and is allowed to make breaking contract changes

This document is intended to be the handoff artifact for the next coding agent.

## Problem Statement

The current CLI is usable for humans, but not yet a stable entrypoint for agents or scripts:

- read commands print human-readable text only
- write commands often print JSON directly
- errors are text-first and sometimes include hints mixed into output
- identifier semantics are ambiguous across Hydro entities
- docs do not fully explain Hydro's data model quirks

The `2.x.x` line should fix those issues without disrupting the existing `1.x.x` users.

## Product Goal

Turn `hydrooj-cli` into a stable machine-facing interface for operating HydroOJ through the addon, while preserving a decent default human-readable mode.

Concretely:

1. Every command must support a machine-safe output mode.
2. Every machine-safe output must use explicit identifier semantics.
3. Human-readable output must remain useful, but must no longer be the only contract.
4. Documentation must explain the Hydro data model well enough that future debugging does not require reading HydroOJ source.

## Non-Goals

- No attempt to preserve text parsing compatibility from `1.x.x`
- No change to the `1.x.x` branch behavior
- No requirement to redesign all REST routes before landing CLI work
- No introduction of submission workflows in `2.0.0` if they do not already exist in the addon

## Branch and Release Strategy

### Branching

- `main`
  - maintenance line for `1.x.x`
  - bugfixes and small compatibility fixes only
- `agentic-rewrite`
  - active `2.x.x` development branch
  - all breaking output/contract changes live here first

### Release plan

- `1.x.x`
  - retain current UX expectations
  - only bugfix and stability improvements
- `2.0.0`
  - first release with the new output contract
  - may change both text output and JSON schema

## Hydro Data Model Decisions

The CLI must stop leaking raw Hydro field ambiguity into user-facing behavior.

### Canonical terminology

- `id`
  - the machine-stable identifier accepted by subsequent CLI/API calls
- `displayId`
  - the human-facing identifier shown in UI or labels when different from `id`

### Entity-specific decisions

#### Problem

- machine id: `docId` (number)
- display id: `pid` (string, optional but usually present)

Reason:

- HydroOJ `problem.get(domainId, pid)` accepts either numeric `docId` or string `pid`
- numeric `docId` is the least ambiguous machine-facing identifier
- `pid` is useful for humans and should be preserved as `displayId`

#### Contest / Homework

- machine id: the contest/homework identifier accepted by detail and related routes
- for the addon in `2.x`, this should be normalized to one stable field emitted as `id`
- display id: optional, only if a meaningful short display identifier exists

Reason:

- HydroOJ contest/homework docs use ObjectId-like identifiers and there is historical confusion between `_id` and `docId`
- the CLI contract must hide that ambiguity and present one machine id only

#### Submission

- machine id: record `_id` string
- `displayId`: not required in `2.0.0`

#### Contest/Homework problem references

- `problemIds` or per-item `id` should refer to problem `docId`
- `displayId` should contain problem `pid` when available

## Output Contract

## Global flags

All commands should support:

- `--json`
- `--pretty`
- `--quiet`

### `--json`

- stdout must contain JSON only
- errors must also be JSON
- no friendly text or hints may be printed to stdout

### `--pretty`

- only applies to JSON mode
- pretty-prints JSON with indentation
- default `--json` may still be pretty by default in `2.0.0`, but the implementation should support toggling if desired

### `--quiet`

- suppresses non-essential diagnostics in human mode
- should not remove command results
- should not affect required JSON output in `--json` mode

## stdout/stderr rules

### Human mode

- command result goes to stdout
- diagnostics and hints may go to stderr

### JSON mode

- stdout: one JSON document only
- stderr: optional diagnostics only when explicitly useful

## JSON Schema Shape

The implementation should use a small set of consistent response envelopes.

### List response

```json
{
  "items": [],
  "page": 1,
  "pageSize": 20,
  "total": 34,
  "totalPages": 2
}
```

### Detail response

```json
{
  "id": "6663de2cfe972abc91b15f37",
  "displayId": null,
  "title": "202406 月赛"
}
```

### Error response

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Contest not found",
    "httpStatus": 404,
    "hint": "Optional remediation text"
  }
}
```

## Required field conventions by command group

### Problem list / detail

Required output fields:

- `id`
- `displayId`
- `title`

Recommended:

- `difficulty`
- `tag`
- `accepted`
- `submission`

### Contest / homework list / detail

Required:

- `id`
- `title`
- `rule`
- `status`

Recommended:

- `displayId`
- `description`
- `startAt`
- `endAt`
- `problemIds`

### Submission list / detail

Required:

- `id`
- `problemId`
- `status`

Recommended:

- `score`
- `time`
- `memory`
- `language`
- `submitAt`

## Human-Readable Output Rules

Default text output should stay concise, but it must stop being ambiguous.

### General principles

- always show machine id explicitly as `id=...` or `id: ...`
- use `display=...` or `displayId: ...` only when meaningful
- never label a `docId` as `pid`
- do not rely on position alone to communicate identifier meaning

### Example: problem list

```text
[id=1234 display=P1001] A + B Problem
```

### Example: contest detail

```text
Contest: 202406 月赛
id: 6663de2cfe972abc91b15f37
status: upcoming
rule: acm
start: 2024-06-01T00:00:00.000Z
end: 2024-06-01T02:00:00.000Z
```

## CLI Surface Changes

## Existing commands to keep

- `config`
- `login`
- `list`
- `show`
- `status`
- `homework`
- `homework-detail`
- `homework-problems`
- `contests`
- `contest-detail`
- `contest-problems`
- `problem-upload`
- `contest-create`
- `homework-create`
- `training-create`

## New command behavior requirements

All existing read commands must:

1. support `--json`
2. emit normalized field names
3. preserve pagination metadata where relevant

## Pagination and filtering flags

At minimum add support for:

- `--page`
- `--page-size`
- `--tag`
- `--difficulty`
- `--keyword`

Future-friendly flags may be stubbed in design but are not required for `2.0.0`:

- `--status`
- `--rule`
- `--begin-after`
- `--begin-before`

## Recommended Code Structure

The current CLI is largely implemented in one file: `cli/ts/index.ts`.

For `2.0.0`, the preferred structure is:

- `cli/ts/index.ts`
  - bootstrap
  - global flag parsing
  - command dispatch
- `cli/ts/contracts.ts`
  - TypeScript interfaces for normalized JSON output
- `cli/ts/output.ts`
  - shared stdout/stderr writers
  - JSON / human render helpers
- `cli/ts/errors.ts`
  - error normalization
  - JSON error envelope generation
- `cli/ts/commands/*.ts`
  - one module per command group when practical

If the implementing agent wants a smaller diff, it is acceptable to keep most logic in `index.ts`, but the following abstractions must still exist conceptually:

- parsed global options
- normalized output helpers
- normalized error helpers

## File-by-File Work Plan

### 1. `cli/ts/index.ts`

Required changes:

- parse global flags before command dispatch
- pass output mode into every command handler
- centralize error handling
- stop mixing user-facing text and machine-facing payloads

Expected result:

- one top-level `main()` path handles all commands consistently

### 2. `addon/routes.ts`

Required changes:

- normalize API payload field names for `2.x` routes if needed
- ensure problem-related responses expose both `id` and `displayId`
- ensure contest/homework-related responses expose one stable machine id

Important:

- if changing addon payloads would break `1.x`, either:
  - keep the old addon branch untouched and do the changes only on `agentic-rewrite`, or
  - introduce versioned response normalization in the CLI while minimizing addon churn

Preferred direction for `agentic-rewrite`:

- normalize addon payloads too, so the CLI does not have to guess semantics

### 3. `README.md`

Required changes:

- stop calling the project read-only if write operations are officially supported
- describe the split between `1.x` and `2.x`
- add an agent/script usage section

### 4. `SPEC.md`

Required changes:

- add `Hydro Data Model Lessons`
- document exact identifier semantics by entity
- document current write operations
- document actual base URL behavior
- document JSON output contract

### 5. `cli/ts/README.md`

Required changes:

- turn it into an operator guide
- include setup, auth, examples, output modes, scripting examples

## Error Handling Design

The implementation agent should normalize all thrown errors through one function.

Pseudo-shape:

```ts
type CliError = {
  code: string;
  message: string;
  httpStatus?: number;
  hint?: string;
};
```

Normalization sources:

- server HTTP errors
- config errors
- login/auth errors
- network errors
- malformed user input

## Testing Strategy

## Minimum acceptance tests

### Human mode

- `hydrooj-cli contests`
- `hydrooj-cli contest-detail <id>`
- `hydrooj-cli contest-problems <id>`
- `hydrooj-cli show <problem-id>`

Verify:

- output remains readable
- identifiers are no longer ambiguous

### JSON mode

- `hydrooj-cli --json contests`
- `hydrooj-cli --json contest-detail <id>`
- `hydrooj-cli --json contest-problems <id>`
- `hydrooj-cli --json list`
- `hydrooj-cli --json show <problem-id>`
- `hydrooj-cli --json status`

Verify:

- stdout is valid JSON
- no extra text appears in stdout
- fields match the documented contract

### Error cases

- missing base URL
- invalid token / not logged in
- nonexistent contest/problem/submission
- server unreachable

Verify:

- JSON mode emits JSON error only
- human mode emits actionable text

## Migration Notes for `2.0.0`

- parsing the old human-readable text format is no longer supported
- scripts and agents should use `--json`
- `id` now always means machine identifier
- `displayId` is for presentation only

## Suggested Delivery Order

### Phase 1

- add global flags
- add normalized output helpers
- add normalized error helpers

### Phase 2

- convert read commands to dual-mode output
- normalize identifiers in CLI output

### Phase 3

- normalize addon payloads where needed
- update docs

### Phase 4

- migration notes
- release prep for `2.0.0`

## Review Checklist for the Follow-Up Coding Agent

- no JSON command writes text noise to stdout
- every entity has explicit `id` semantics
- `problem.id` and `problem.displayId` are not conflated
- contest/homework ids are stable across list and detail
- docs match actual behavior
- `1.x` compatibility line remains isolated on `main`
