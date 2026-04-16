# File Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a synchronous `filter` option that lets users choose which Vue SFC files should go through the resolver.

**Architecture:** Extend the existing options object with a `filter(context)` callback, evaluate it in the plugin transform hook after the current fast-path guards, and leave all existing rewrite behavior unchanged for files that are allowed through.

**Tech Stack:** TypeScript, Vite plugin API via `vite-plus`, Vitest via `vite-plus/test`, MagicString, existing integration test helpers

---

## Planned File Structure

### Modify

- `src/options.ts`
- `src/plugin.ts`
- `src/index.ts`
- `tests/plugin.integration.test.ts`
- `README.md`

## Task 1: Add regression tests for filter behavior

- [ ] Write a test that passes `filter: ({ id }) => id.endsWith("Enabled.vue")` and verifies `Enabled.vue` is rewritten.
- [ ] Run the targeted test and confirm it passes under the existing behavior baseline.
- [ ] Write a test that passes the same filter and verifies `Disabled.vue` is not rewritten.
- [ ] Run the targeted test and confirm it fails before implementation because the plugin still rewrites the file.

## Task 2: Add the public filter option

- [ ] Add exported filter context and filter function types in `src/options.ts`.
- [ ] Add `filter` to `VueTypeResolverOptions` and normalized options.
- [ ] Re-export any new public types from `src/index.ts`.

## Task 3: Apply filtering in the transform path

- [ ] In `src/plugin.ts`, evaluate the normalized filter after the existing `.vue` and typed-macro guards.
- [ ] Return `null` when the filter rejects the file.
- [ ] Keep cache, warnings, and tsgo session behavior unchanged for accepted files.

## Task 4: Update docs and verify

- [ ] Add a README example showing how to target only selected SFCs.
- [ ] Run `vp test`.
- [ ] Run `vp check`.
