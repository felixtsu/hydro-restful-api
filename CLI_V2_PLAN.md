# HydroOJ CLI 2.0.0 Plan

## Goal

Turn `hydrooj-cli` from a human-oriented helper into a stable agent/script entrypoint for HydroOJ.

This document is intentionally separate from the `1.2.x` bugfix line. `1.2.x` should stay focused on compatibility and correctness, while `2.0.0` can make deliberate output and interface changes.

## Why 2.0.0

The current CLI mixes two different contracts:

- Read commands print human-friendly text.
- Write commands often print JSON.
- Some identifiers are display-oriented, others are lookup-oriented.
- Output is not yet consistent enough for agents to parse safely.

Changing that contract is a breaking interface change, so it should ship as `2.0.0`.

## Main Design Goals

1. Every command should have a machine-safe output mode.
2. Identifier semantics must be explicit.
3. Human mode should remain pleasant, but never be the only stable interface.
4. Docs should explain Hydro's data model quirks so users and agents can recover from future issues without reading source.

## Proposed CLI Contract

### 1. Global Output Modes

Add global flags:

- `--json`
- `--pretty`
- `--quiet`

Rules:

- `--json` prints only JSON to stdout.
- Errors in `--json` mode should also be JSON.
- Human-readable text goes to default mode only.
- Diagnostics and hints should go to stderr, never mixed into JSON stdout.

## 2. Identifier Semantics

Every entity in JSON mode should use explicit names:

- `id`: the machine-stable identifier accepted by subsequent CLI/API calls
- `displayId`: the user-facing identifier if different
- `title` or `name`: display name

Examples:

- Problem:
  - `id`: Hydro problem `docId`
  - `displayId`: Hydro problem `pid` when available
- Contest / Homework:
  - `id`: stable contest/homework identifier accepted by detail endpoints
  - `displayId`: optional human label if one exists
- Submission:
  - `id`: submission record id
  - `displayId`: optional short form if introduced later

## 3. Human Output Conventions

Default human mode should still be clean, but clearer:

- Always show the machine id explicitly.
- Show display id only when meaningful.
- Avoid ambiguous labels like `pid` when the value is actually `docId`.

Example human output:

```text
Contest: 202406 月赛
id: 6663de2cfe972abc91b15f37
status: upcoming
rule: acm
```

Problem list example:

```text
[id=1234 display=P1001] A + B Problem
```

## 4. Pagination and Filtering

Read commands should accept explicit query flags:

- `--page`
- `--page-size`
- `--tag`
- `--difficulty`
- `--keyword`
- future: `--status`, `--rule`, `--begin-after`, `--begin-before`

JSON list responses should include:

- `items`
- `page`
- `pageSize`
- `total`
- `totalPages`

## 5. Error Contract

Standardize errors in JSON mode:

```json
{
  "error": {
    "code": "NOT_FOUND",
    "message": "Contest not found",
    "httpStatus": 404
  }
}
```

Human mode can keep friendly hints, but should separate:

- user/actionable message
- raw server error
- install/config hint

## 6. Documentation Updates Required

### `README.md`

- Stop describing the project as read-only if write endpoints are supported.
- Clarify addon vs CLI roles.
- Add an agent/script-oriented section.

### `SPEC.md`

Add a dedicated section:

- `Hydro Data Model Lessons`

It should explain:

- contest and homework are stored in the same underlying document family
- `rule: "homework"` is the discriminator
- `_id`, `docId`, and display identifiers are not interchangeable
- commands and endpoints must document which identifier they accept

Also fix drift between docs and implementation:

- current supported write operations
- actual base URL behavior
- actual output contract

### `cli/ts/README.md`

Expand from a package blurb into an operator reference:

- setup
- auth
- output modes
- examples for human and JSON mode
- scripting examples

## 7. Migration Notes

`2.0.0` should ship with a migration section:

- old text parsing is unsupported
- use `--json` for scripts and agents
- `id` now means machine id only
- `displayId` is for presentation only

## Suggested Implementation Order

1. Add shared output formatter utilities.
2. Add global flag parsing.
3. Convert read commands to dual-mode output.
4. Normalize identifier fields per entity.
5. Normalize error output.
6. Rewrite docs.
7. Tag and publish `2.0.0`.
