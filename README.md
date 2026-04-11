# vite-plugin-vue-type-resolver

Resolve Vue `defineProps<T>()` types with `tsgo` and lower them to finite type literals before Vue's SFC compiler runs.

## Why

Vue's built-in `resolveType.ts` is largely AST-driven. That works for many local and simple cases, but it loses power once the root props type depends on the real TypeScript type system: imported utility types, global ambient types, third-party declarations, intersections, mapped types, and checker-only reductions.

This plugin takes a different route:

1. ask `tsgo` for the actual root props type that TypeScript sees in the current project
2. materialize that root type into a finite anonymous type literal
3. rewrite only the `defineProps<T>()` generic argument
4. let Vue keep doing its normal runtime-props inference from the lowered literal

The plugin does not replace Vue's compiler. It feeds Vue a simpler type.

## Shipped Behavior

- resolves `defineProps<T>()` with `tsgo`
- supports local, imported, global, and third-party types visible to the current project
- rewrites only the generic type argument
- warns and leaves the source unchanged when type analysis or root-props materialization cannot complete safely
- does not generate runtime props options by itself
- does not replace Vue's full compile pipeline

## High-Level Architecture

```txt
Vue SFC
  |
  v
[typed defineProps<T>() fast path hit?]
  |-- no ---> return original source
  |
  '-- yes --> parse SFC and find defineProps calls
               |
               v
             collect imports and local TS declarations
               |
               v
             build synthetic analysis module
               |
               v
             TsgoSession.describeRootType(...)
               |
               v
    +-------------------------------------------------------------------------+
    |                              TsgoSession                                |
    |                                                                         |
    |  prepare virtual overlay file                                           |
    |    |                                                                    |
    |    v                                                                    |
    |  updateSnapshot(changedFiles)                                           |
    |    |                                                                    |
    |    |-- success ----------------------------------------------------+    |
    |    |                                                               |    |
    |    '-- "source file not found" or                                 |    |
    |        "synthetic target type was not resolved"                   |    |
    |             |                                                     |    |
    |             '-- retry once with updateSnapshot(invalidateAll: true)+    |
    |                                                                         |
    |  resolveName + getDeclaredTypeOfSymbol                                  |
    |    |                                                                    |
    |    v                                                                    |
    |  describe root properties and index signatures                          |
    +-------------------------------------------------------------------------+
               |
               v
             [finite root object?]
               |-- no ---> warn and fall back to Vue default behavior
               |
               '-- yes --> materialize root props
                            |
                            v
                          print anonymous type literal
                            |
                            v
                          rewrite only T in defineProps<T>()
                            |
                            v
                          @vitejs/plugin-vue / compiler-sfc
                            |
                            v
                          Vue infers runtime props from lowered literal
```

## Example

Input:

```ts
import type { Simplify } from "type-fest";

type Base = {
  title: string;
  count?: number;
};

type Props = Simplify<
  Readonly<
    Base & {
      pinned: boolean;
      meta: {
        mode: "a" | "b";
      };
    }
  >
>;

defineProps<Props>();
```

Lowered before Vue sees it:

```ts
defineProps<{
  readonly title: string;
  readonly count?: number;
  readonly pinned: boolean;
  readonly meta: {
    mode: "a" | "b";
  };
}>();
```

Vue can then run its normal runtime type inference on the rewritten literal.

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { vueTypeResolver } from "vite-plugin-vue-type-resolver";

export default defineConfig({
  plugins: [vueTypeResolver(), vue()],
});
```

The plugin works on Vue SFCs that use `<script setup lang="ts">` and `defineProps<T>()`.
If your project does not keep `tsconfig.json` at the Vite root, pass `tsconfigPath` to point the resolver at the right project file.

```ts
vueTypeResolver({
  tsconfigPath: "./tsconfig.app.json",
  logSnapshotStats: true,
});
```

`logSnapshotStats` prints the session-level incremental/full-snapshot counters when the Vite lifecycle closes.

## How It Works

### 1. Synthetic analysis module

The plugin does not ask `tsgo` to analyze the `.vue` file directly. Instead it builds a small synthetic TypeScript module next to the component that contains:

- the imports from `<script>` and `<script setup>`
- supported local declarations copied from the SFC
- a synthetic alias like `type __VTR_Target_0 = <original defineProps type>`

That module gives `tsgo` a normal TypeScript file to analyze, with the same project-visible symbols the component can already use.

### 2. Checker-first root type resolution

`TsgoSession` opens the real project from `tsconfig.json`, then resolves the synthetic target alias with checker APIs such as:

- `resolveName`
- `getDeclaredTypeOfSymbol`
- `getPropertiesOfType`
- `getIndexInfosOfType`
- `typeToString`

This is the key difference from Vue's AST-only path: the resolver sees whatever the TypeScript project sees, including global ambient types and types coming from third-party packages.

### 3. Root props materialization

The `tsgo` result is not printed back verbatim. The plugin first turns the resolved root type into a finite data model:

- root properties
- optional and readonly modifiers
- primitives and literals
- arrays, tuples, unions, intersections, and function placeholders
- nested anonymous object shapes when they are safe to inline

If the root type cannot be turned into a finite object literal safely, the plugin warns and leaves the source untouched.

### 4. Minimal source rewrite

The plugin only overwrites the generic argument span inside `defineProps<T>()`. It does not reorder code, does not touch the rest of the SFC, and does not try to generate a runtime props object on its own.

## Performance Architecture

The current design is built so the expensive part is amortized instead of repeated.

### Fast path guard

Before any SFC parsing or `tsgo` startup, the plugin checks for a likely typed `defineProps<T>()` shape. Files without `<script setup lang="ts">` plus generic `defineProps` return immediately.

### Shared `TsgoSession`

One `TsgoSession` is reused across transforms in the same Vite lifecycle. The session is closed in `buildEnd` and `closeBundle`.

That means the common path is:

- start `tsgo` once
- reuse the same loaded project graph
- answer many `.vue` transforms against that graph

### Transform cache

The plugin caches transform results by:

- absolute `.vue` file id
- exact source text

If the same component is transformed again with unchanged source, the previous output and warnings are replayed without re-running `tsgo`.

### Selective invalidation

- when a `.vue` file changes, only that component's transform cache entry is dropped
- when a non-`.vue` file changes, the transform cache is cleared because shared type dependencies may have changed
- changed non-`.vue` paths are passed into the next `tsgo` snapshot update

This keeps hot paths small while still letting upstream type changes invalidate the right work.

## Incremental Snapshot Strategy

The tricky part is keeping `tsgo` incremental without getting stuck in stale snapshot state.

### Stable overlay files

`TsgoSession` analyzes synthetic modules through virtual overlay files like `__vtr__0.ts` and `__vtr__1.ts`.

The overlay strategy is:

- keep a stable overlay identity during normal steady-state transforms
- when upstream non-`.vue` files change, rotate to the other overlay slot for that directory
- include a `__vtr_changed__` marker in the virtual source text so the snapshot definitely sees new content

This avoids paying for a full project invalidation on every transform while still giving snapshot updates a clean path when dependencies change.

### Incremental first, full rebuild only on demand

Every analysis request tries `updateSnapshot` with `changedFiles` first.

If that request fails with one of the snapshot-consistency errors below, the same request is retried once with `invalidateAll: true`:

- `source file not found`
- `synthetic target type was not resolved`

After that retry, later requests still go back to incremental mode first. Full invalidation is a one-request escape hatch, not a permanent mode switch.

### Why those two fallback errors matter

`source file not found` usually means the incremental snapshot graph still points at a source identity that no longer matches the current overlay/dependency picture.

`synthetic target type was not resolved` usually means the updated snapshot did not fully rebind the synthetic alias or one of its imported dependencies in the current incremental step.

Those are good candidates for a one-off full rebuild because they describe snapshot drift, not a real user type error.

## Safety Boundaries and Fallbacks

The plugin deliberately falls back to Vue's default behavior when it cannot prove the rewrite is safe.

Current fallback cases include:

- analysis failure in `tsgo`
- root open index signatures
- unsupported computed property keys
- property shapes that cannot be materialized into a stable printed literal

The warning is explicit and the original SFC source is preserved, so the project can continue to compile under Vue's existing behavior.

## Observability

Enable `logSnapshotStats` to inspect how often the session stays incremental versus falling back to full invalidation:

```txt
[vite-plugin-vue-type-resolver] tsgo snapshot stats {
  currentMode: 'incremental',
  incrementalAttempts: 3,
  incrementalSuccesses: 3,
  fullRebuilds: 0,
  fallbacks: {
    sourceFileNotFound: 0,
    syntheticTargetTypeNotResolved: 0
  }
}
```

That output is useful for validating performance in a real project instead of guessing.

## Limitations

- runtime props options are not generated directly by this plugin; Vue still does that after the rewrite.
- only `defineProps<T>()` is handled right now.
- if `tsgo` cannot analyze the type, or if the root props type cannot be made finite and safe to print, the source is left unchanged and a warning is emitted.
- Vue still performs the rest of its normal single-file-component compile pipeline.
