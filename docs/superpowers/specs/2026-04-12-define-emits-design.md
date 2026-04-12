# defineEmits<T>() Design

Date: 2026-04-12
Status: Draft

## Summary

Add `defineEmits<T>()` support to `vite-plugin-vue-type-resolver` using the same additive strategy as `defineProps<T>()`:

- detect typed `defineEmits<T>()` call sites in `<script setup lang="ts">`
- resolve `T` through the real project type system with `tsgo`
- reduce complex emits types into a simple finite type literal that Vue can already consume
- let Vue continue through its normal compile pipeline
- warn and fall back to Vue's default behavior when reduction is not reliable

## Goals

- Support only `defineEmits<T>()` in this iteration.
- Preserve the current `defineProps<T>()` architecture and fallback policy.
- Support emits types that come from:
  - local declarations
  - imported project types
  - global types
  - third-party library types
- Only extract finite event-name sets.
- Do not attempt runtime payload validation.

## Non-Goals

- runtime validator generation from payload types
- `defineEmits({...})` runtime object mode
- `defineEmits(['a', 'b'])` array mode
- `defineSlots`
- changing Vue's own runtime emits extraction

## Canonical Rewrite Shape

The plugin rewrites complex typed emits into a property-style type literal:

```ts
defineEmits<{
  change: any[];
  "update:modelValue": any[];
}>();
```

Vue already extracts runtime event names from property-style typed emits, so the plugin only needs to guarantee that the rewritten type is finite and stable.

## Resolution Strategy

1. Parse the SFC and find `defineEmits<T>()`.
2. Reuse the same virtual analysis module approach already used for `defineProps<T>()`.
3. Resolve the synthetic alias for `T` through `tsgo`.
4. Convert the resolved type into a finite set of event names.
5. Rewrite only the generic type argument.
6. Let Vue produce runtime `emits`.

## Event Name Extraction Rules

Supported source shapes:

- function type / call signatures where the first parameter is a finite string-literal union
- type literals with property syntax
- intersections and unions that reduce to finite event-name sets
- imported aliases that `tsgo` expands into one of the above forms

Fallback conditions:

- wide `string` event names
- non-literal template event names
- unsupported root type shapes
- mixed property and call-signature syntax
- `tsgo` analysis failures

## Warning Policy

When emits materialization fails, the plugin must:

- emit a warning that names the file and reason
- leave the original `defineEmits<T>()` untouched
- let Vue continue with its default behavior

## Testing Strategy

- unit tests for emits event-name extraction
- plugin integration tests for typed emits rewriting and fallback
- playground tests that compile SFC output and assert runtime `emits`
- real third-party fixture coverage using `element-plus` and `vue-component-type-helpers`
