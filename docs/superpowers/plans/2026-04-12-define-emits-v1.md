# defineEmits<T>() Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `defineEmits<T>()` support that rewrites complex typed emits into finite property-style type literals and falls back cleanly when event names cannot be reduced safely.

**Architecture:** Reuse the existing `defineProps<T>()` pipeline. Add a second typed-macro path for `defineEmits<T>()`, resolve the root type through the same `tsgo` session, extract finite event names, print a stable emits type literal, and leave Vue in charge of generating runtime `emits`.

**Tech Stack:** TypeScript, Vite plugin API via `vite-plus`, `@vue/compiler-sfc`, `@babel/parser`, `magic-string`, `tsgo`, Vitest via `vite-plus/test`, real playground deps (`element-plus`, `vue-component-type-helpers`)

---

## Planned File Structure

### Modify

- `src/plugin.ts`
- `src/sfc/findDefinePropsCalls.ts` or sibling macro finder
- `src/tsgo/session.ts`
- `src/warnings.ts`
- `tests/plugin.integration.test.ts`
- `tests/playground-compile.test.ts`
- `playground/package.json`
- `playground/src/App.vue`

### Create

- `src/sfc/findDefineEmitsCalls.ts`
- `src/emits/extractEventNames.ts`
- `src/emits/printEmitsTypeLiteral.ts`
- `tests/emits-extract.test.ts`
- `playground/src/components/ImportedGenericEmitCase.vue`

## Task 1: Add failing tests for emits extraction and plugin rewriting

- [ ] Add unit tests for extracting finite event names from function, overload, and property-style types.
- [ ] Add plugin integration tests for:
  - local overload typed emits rewrite
  - imported third-party helper typed emits rewrite
  - fallback on wide string event names
- [ ] Run the targeted tests and confirm they fail before implementation.

## Task 2: Add the emits analysis path

- [ ] Add `findDefineEmitsCalls`.
- [ ] Extend the plugin transform to detect and rewrite typed emits.
- [ ] Add warning formatting for emits fallback.

## Task 3: Extract finite event names from resolved types

- [ ] Add a session method that resolves the target type and produces a finite event-name set.
- [ ] Parse the resolved type text and support:
  - property syntax
  - call signatures
  - intersections / unions that remain finite
- [ ] Fall back on wide or unsupported event-name shapes.

## Task 4: Add real playground coverage

- [ ] Install `element-plus` and `vue-component-type-helpers` in `playground/`.
- [ ] Add `ImportedGenericEmitCase.vue` using `ComponentEmit<typeof ElTable>`.
- [ ] Assert compiled runtime `emits` output.

## Task 5: Verify and clean up

- [ ] Run focused emits tests.
- [ ] Run full `playground` compile tests.
- [ ] Run repo test suite and typecheck.
- [ ] Update snapshots if compiled output changes.
