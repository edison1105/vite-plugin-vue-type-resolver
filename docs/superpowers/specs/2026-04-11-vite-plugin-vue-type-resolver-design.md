# vite-plugin-vue-type-resolver Design

Date: 2026-04-11
Status: Draft

## Summary

`vite-plugin-vue-type-resolver` is a Vite plugin that enhances Vue `defineProps<T>()` type resolution by using `tsgo`'s real project-wide type system instead of Vue's current AST-only `resolveType.ts` strategy.

The plugin targets one narrow job in its first version:

- detect `defineProps<T>()` in Vue SFCs
- resolve `T` using a `tsgo`-backed type checker in the context of the current project
- materialize complex root props types into a finite TypeScript type literal
- rewrite only the type argument passed to `defineProps`
- let Vue continue through its normal compile pipeline
- warn and fall back to Vue's default behavior when materialization is not possible

The plugin is an enhancer, not a replacement compiler. It should widen the range of props types Vue can understand while preserving Vue's existing behavior as the fallback path.

## Problem

Vue's current `resolveType.ts` is based on Babel AST inspection and a growing set of handwritten rules. That works for simple local type syntax, but it breaks down for more complex cases such as:

- imported type aliases
- project-global types
- third-party library types
- mapped types
- indexed access types
- conditional types
- utility types after generic instantiation
- other types that require a real project-aware type checker

The project goal is not to add more special cases to the AST resolver. The goal is to resolve props from the actual project type system and then lower the result into a form Vue already knows how to consume.

## Goals

- Support only `defineProps<T>()` in v1.
- Resolve types from any source available to the current TypeScript project:
  - local file declarations
  - cross-file imports
  - global types
  - third-party library types
- Base resolution on `tsgo` type-checking rather than Vue's AST-only logic.
- Materialize the root props type into a finite anonymous type literal.
- Rewrite the smallest possible source span.
- Preserve Vue's existing compile behavior after the rewrite.
- Emit clear warnings and fall back cleanly when materialization fails.

## Non-Goals

- `defineEmits`
- `defineSlots`
- direct runtime props generation
- replacing Vue's entire type-resolution pipeline
- handling arbitrary runtime code analysis outside the `defineProps<T>()` type context
- guaranteeing that every valid TypeScript type can be lowered into runtime props

## Product Boundary

The plugin is responsible for one transformation:

1. find `defineProps<T>()`
2. resolve `T` through `tsgo`
3. if `T` can be reduced to a finite props object, replace `T` with a materialized type literal
4. otherwise warn and do nothing

The plugin is not responsible for:

- computing final runtime props metadata itself
- changing macro semantics
- generating sidecar files for users to import manually
- mutating unrelated code in the SFC

## Failure Policy

When the plugin cannot safely materialize the root props type, it must:

- emit a clear warning with file path and reason
- leave the source unchanged
- allow Vue to continue with its default behavior

This keeps the plugin additive and safe to adopt incrementally.

## High-Level Architecture

The design is based on a pre-transform Vite plugin that runs before Vue's main SFC transform.

### Pipeline

1. The plugin receives a `.vue` file during transform.
2. It parses the SFC and finds direct `defineProps<T>()` calls.
3. For each type argument `T`, it builds a minimal analysis-oriented virtual TypeScript module.
4. It asks a long-lived `tsgo` session to resolve the declared type of a synthetic alias that points at `T`.
5. It attempts to materialize the resolved type into a finite type literal.
6. On success, it rewrites only the generic argument in `defineProps<T>()`.
7. On failure, it warns and returns the original source.

### Integration Strategy

The first version should use a Vite plugin with `enforce: 'pre'`.

This is preferred over taking over Vue internals because it:

- minimizes coupling with `@vitejs/plugin-vue`
- keeps the fallback path simple
- lets Vue remain the owner of later compile steps
- reduces upgrade risk against future Vue releases

## tsgo Usage Model

The plugin should be built around a long-lived `tsgo` API session rather than one-off CLI invocations.

### Session Requirements

- open the current project using the nearest relevant `tsconfig.json`
- maintain incremental snapshots across rebuilds
- bridge both on-disk files and plugin-provided virtual files
- reuse one session per Vite server or build process where practical

### Why tsgo

The plugin needs a project-aware type system, not a syntax walker. `tsgo` can already expose the capabilities needed for a proof-of-concept:

- get declared types of symbols
- get properties of object types
- inspect index signatures
- inspect type arguments
- inspect base types
- inspect conditional and indexed-access structures
- print or reify types via `typeToString` and `typeToTypeNode`

The current API is private and not yet marked stable, so the implementation should treat it as an internal integration dependency rather than a public contract.

## Virtual File Strategy

The plugin should not attempt to fully compile `.vue` files into executable TS. It only needs to reconstruct the type environment relevant to `defineProps<T>()`.

### Design Principle

Build the smallest virtual module that preserves the type environment required to resolve `T`.

### Virtual Module Contents

For each SFC under analysis, the generated virtual module should include:

- the relevant `import` and `import type` declarations
- local `type`, `interface`, `enum`, and `declare` declarations
- any local declarations needed to preserve the meaning of `T`
- a synthetic anchor alias:

```ts
type __VTR_Target_0 = T;
```

The plugin then resolves `__VTR_Target_0` through the checker and treats that as the root props type.

### Exclusions

The virtual module should avoid pulling in unrelated runtime code unless needed to preserve type meaning. In v1, the implementation should prefer a minimal type-environment reconstruction over a full script-setup lowering pipeline.

## Materialization Model

The plugin should not print source directly from checker output at first contact. It should first build a semantic intermediate representation.

### Result Shape

```ts
type MaterializeResult =
  | { ok: true; props: MaterializedPropMap; warnings: Warning[] }
  | { ok: false; reason: FallbackReason; warnings: Warning[] };

type MaterializedPropMap = Map<string, MaterializedProp>;

type MaterializedProp = {
  key: string;
  optional: boolean;
  readonly: boolean;
  type: MaterializedType;
};

type MaterializedType =
  | { kind: "primitive"; name: string }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "array"; element: MaterializedType }
  | { kind: "tuple"; elements: MaterializedType[]; rest?: MaterializedType; readonly: boolean }
  | { kind: "union"; types: MaterializedType[] }
  | { kind: "intersection"; types: MaterializedType[] }
  | { kind: "function" }
  | { kind: "object"; props: MaterializedPropMap }
  | { kind: "reference"; text: string };
```

This IR keeps the algorithm semantic-first and allows the final printer to stay small and deterministic.

## Root Type Rules

The root `defineProps<T>()` type must be stricter than nested value types.

The root can only be materialized if it resolves to a finite object-like property set.

### Root Success Conditions

- the checker can enumerate a finite property set
- there is no open string or number index signature
- each property can be resolved to a concrete value type expression or stable fallback text

### Root Failure Conditions

- open index signatures such as `Record<string, X>`
- root type is not object-like
- unresolved or uninstantiated generic root structure
- recursive structures that do not stabilize
- computed or symbol keys that cannot be printed as stable props

If any root failure condition is hit, the plugin must warn and fall back.

## Property Collection Rules

For each property symbol on the root type:

- use the checker's final property set rather than source syntax
- read the property name from the symbol
- determine optional and readonly flags
- resolve the property type with contextual APIs such as `getTypeOfSymbolAtLocation` when available

This ensures the materialized shape reflects the instantiated type system view rather than the original syntax tree.

## Value-Type Materialization Rules

Nested property value types are allowed to be more flexible than the root.

### Expand Structurally

Prefer direct structural materialization for:

- primitives
- literals
- arrays
- tuples
- functions
- finite nested objects
- unions and intersections that remain manageable

### Preserve as Stable Text

When a nested type is valid and stable but not worth recursively exploding, preserve it as a printed type expression.

Candidate tools:

- `typeToTypeNode` plus a printer
- `typeToString`

This path is valid for nested property values, but not for the root props object.

### Fail the Whole Root

If a nested value type cannot be expressed safely enough to keep the root sound, the plugin should fail the overall materialization and fall back.

## Recursive and Complex Types

The plugin should treat checker output as the source of truth for complex types such as:

- conditional types
- indexed access types
- mapped types
- utility types after instantiation

The plugin should not recreate Vue's current syntax-driven special-case logic.

If the checker has already reduced the type to a finite object with stable properties, the plugin should continue. If the checker still exposes an open or unstable structure, the plugin should fall back.

## Cycle and Depth Controls

The materializer must include both:

- visited-type tracking by checker type identity
- a maximum recursive depth

Recommended behavior:

- if a nested value type exceeds depth, prefer stable text fallback
- if the root object cannot be completed without exceeding safe limits, fail and fall back

These controls keep the plugin predictable for recursive and pathological type graphs.

## Source Rewrite Rules

On success, the plugin should rewrite only the generic type argument supplied to `defineProps`.

Example:

```ts
defineProps<Props>();
```

may become:

```ts
defineProps<{
  foo: string;
  bar?: number;
  baz: External | null;
}>();
```

The plugin should not:

- change the macro call shape
- inject runtime props objects
- rewrite unrelated imports or declarations

## Warning Design

Warnings should be explicit and actionable. Each warning should include:

- plugin name
- file path
- which `defineProps<T>()` site failed
- a short failure reason
- note that the plugin is falling back to Vue's default type resolution

Example:

```txt
[vite-plugin-vue-type-resolver] Failed to materialize defineProps type in /src/App.vue:
open index signature detected in Record<string, Foo>.
Falling back to Vue's default type resolution.
```

## Caching and Incrementality

The implementation should plan for caching from the start:

- cache parsed SFC analysis per file content hash
- cache virtual-module generation results
- reuse the `tsgo` session and snapshots
- invalidate only files affected by Vite or filesystem changes

This matters because type resolution across project and dependency boundaries can become expensive during development.

## Testing Strategy

The first test matrix should focus on outcome, not internal implementation details.

### Happy Path

- local interface props
- imported type alias props
- global type props
- third-party library type props
- mapped and utility types that reduce to finite props
- intersections and inherited props

### Fallback Path

- `Record<string, X>`
- unresolved generics
- recursive or depth-limited cases
- unsupported computed keys

### Integration Path

- transformed source only changes the generic argument
- warning is emitted when fallback happens
- unchanged source is returned on fallback
- Vue can continue compiling after success or failure

## Milestones

### Milestone 1: Analysis and Session Skeleton

- locate `defineProps<T>()`
- create a reusable `tsgo` session wrapper
- resolve a synthetic root alias from a virtual module

### Milestone 2: Root Props Materialization

- enumerate finite root props
- detect open index signatures
- print a basic anonymous type literal

### Milestone 3: Nested Value Types

- support arrays, tuples, unions, intersections, and nested objects
- add stable text fallback for complex nested values

### Milestone 4: Integration and Warnings

- perform minimal source rewrites
- add warnings and Vue fallback behavior
- verify with integration tests

## Open Questions

- What is the minimum virtual-module reconstruction needed for `script setup` to preserve the meaning of all local type declarations?
- Should nested object property types always be fully expanded when possible, or should there be a configurable preference for keeping references shorter?
- What is the best project-discovery strategy when multiple `tsconfig.json` files are relevant in one workspace?
- How tightly should the implementation bind to current private `tsgo` APIs versus wrapping them behind an internal adapter layer from day one?

## Recommendation

Proceed with a v1 centered on a pre-transform materializer for `defineProps<T>()`, backed by a long-lived `tsgo` session and a deliberately small virtual-file reconstruction strategy.

That path provides the highest value while keeping the plugin narrow, fallback-friendly, and compatible with Vue's existing compile pipeline.
