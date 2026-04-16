# vite-plugin-vue-type-resolver

Resolve Vue `defineProps<T>()` and `defineEmits<T>()` types with `tsgo` before Vue's SFC compiler runs.

## Why

Vue's built-in [`resolveType.ts`](https://github.com/vuejs/core/blob/main/packages/compiler-sfc/src/script/resolveType.ts) is largely AST-driven. That works for many local and simple cases, but it loses power once the root props type depends on the real TypeScript type system: imported utility types, global ambient types, third-party declarations, intersections, mapped types, and checker-only reductions.

This plugin takes a different route:

1. ask `tsgo` for the actual macro type that TypeScript sees in the current project
2. lower `defineProps<T>()` to a finite anonymous type literal, or `defineEmits<T>()` to a finite event map
3. rewrite only the original generic type argument
4. let Vue keep doing its normal runtime inference from the lowered type

The plugin does not replace Vue's compiler. It feeds Vue a simpler type.

## Shipped Behavior

- resolves `defineProps<T>()` and `defineEmits<T>()` with `tsgo`
- supports local, imported, global, and third-party types visible to the current project
- rewrites only the generic type argument
- warns and leaves the source unchanged when type analysis or lowering cannot complete safely
- does not generate runtime props or emits options by itself
- does not replace Vue's full compile pipeline

## Performance Architecture

The plugin is designed so `tsgo` startup and project loading are reused instead of repeated.

- a fast path skips files that obviously do not contain typed `defineProps<T>()` or `defineEmits<T>()`
- one `TsgoSession` is shared across transforms in the same Vite lifecycle
- transform results are cached for unchanged `.vue` sources
- when upstream type files change, the plugin prefers incremental snapshot updates and only falls back to a full rebuild when needed

The goal is simple: keep the common path incremental, while still recovering cleanly when the TypeScript snapshot state drifts.

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

## Installation

```bash
pnpm add -D vite-plugin-vue-type-resolver
```

```bash
npm install -D vite-plugin-vue-type-resolver
```

```bash
yarn add -D vite-plugin-vue-type-resolver
```

```bash
bun add -d vite-plugin-vue-type-resolver
```

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

The plugin works on Vue SFCs that use `<script setup lang="ts">` and typed `defineProps<T>()` or `defineEmits<T>()`.
If your project does not keep `tsconfig.json` at the Vite root, pass `tsconfigPath` to point the resolver at the right project file.

```ts
vueTypeResolver({
  tsconfigPath: "./tsconfig.app.json",
  logSnapshotStats: true,
});
```

`logSnapshotStats` prints the session-level incremental/full-snapshot counters when the Vite lifecycle closes.

If only some components need tsgo-backed rewriting, pass a synchronous `filter` function.

```ts
vueTypeResolver({
  filter({ id }) {
    return id.includes("/src/components/complex/") || id.endsWith("HeavyTable.vue");
  },
});
```

The filter receives the Vue file path as `id` and the original SFC source as `code`. Return `true` to let the resolver run for that file, or `false` to skip it entirely.

## How It Works

### 1. Synthetic analysis module

The plugin does not ask `tsgo` to analyze the `.vue` file directly. Instead it builds a small synthetic TypeScript module next to the component that contains:

- the imports from `<script>` and `<script setup>`
- supported local declarations copied from the SFC
- a synthetic alias like `type __VTR_Target_0 = <original macro type>`

That module gives `tsgo` a normal TypeScript file to analyze, with the same project-visible symbols the component can already use.

### 2. Checker-first type resolution

`TsgoSession` opens the real project from `tsconfig.json`, then resolves the synthetic target alias with checker APIs such as:

- `resolveName`
- `getDeclaredTypeOfSymbol`
- `getPropertiesOfType`
- `getIndexInfosOfType`
- `typeToString`

This is the key difference from Vue's AST-only path: the resolver sees whatever the TypeScript project sees, including global ambient types and types coming from third-party packages.

### 3. Lowering step

The `tsgo` result is not printed back verbatim.

For `defineProps<T>()`, the plugin first turns the resolved root type into a finite data model:

- root properties
- optional and readonly modifiers
- primitives and literals
- arrays, tuples, unions, intersections, and function placeholders
- nested anonymous object shapes when they are safe to inline

For `defineEmits<T>()`, the plugin extracts a finite event-name set from either property syntax or call signatures, then prints it back as an event map that Vue can infer at runtime.

If the resolved type cannot be lowered safely, the plugin warns and leaves the source untouched.

### 4. Minimal source rewrite

The plugin only overwrites the generic argument span inside `defineProps<T>()` or `defineEmits<T>()`. It does not reorder code, does not touch the rest of the SFC, and does not try to generate runtime options on its own.

## Limitations

- runtime props and emits options are not generated directly by this plugin; Vue still does that after the rewrite.
- only typed `defineProps<T>()` and `defineEmits<T>()` are handled.
- if `tsgo` cannot analyze the type, or if the lowered result cannot be made finite and safe to print, the source is left unchanged and a warning is emitted.
- Vue still performs the rest of its normal single-file-component compile pipeline.

## High-Level Architecture

```mermaid
flowchart TD
    A[Vue SFC] --> B{typed defineProps<br/>fast path hit?}
    B -- no --> Z[Return original source]
    B -- yes --> C[Parse SFC and find defineProps calls]
    C --> D[Collect imports and local TS declarations]
    D --> E[Build synthetic analysis module]
    E --> F[TsgoSession.describeRootType]

    subgraph S[TsgoSession]
      F --> G[Prepare virtual overlay file]
      G --> H[updateSnapshot changedFiles]
      H --> I{incremental snapshot ok?}
      I -- no, snapshot drift --> J[retry once with invalidateAll]
      I -- yes --> K[resolveName plus getDeclaredTypeOfSymbol]
      J --> K
      K --> L[Describe root properties and index signatures]
    end

    L --> M{finite root object?}
    M -- no --> N[Warn and fall back to Vue default behavior]
    M -- yes --> O[Materialize root props]
    O --> P[Print anonymous type literal]
    P --> Q[Rewrite only the defineProps type argument]
    Q --> R[Vue plugin pipeline]
    R --> S2[Vue infers runtime props from lowered literal]
```
