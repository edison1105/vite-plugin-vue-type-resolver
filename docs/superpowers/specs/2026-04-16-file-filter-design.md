# File Filter Design

Date: 2026-04-16
Status: Approved for implementation

## Summary

Add an optional file filter to `vite-plugin-vue-type-resolver` so callers can decide which Vue SFCs should use the resolver.

The filter is a synchronous function:

```ts
filter?: (context: { id: string; code: string }) => boolean
```

When the filter returns `false`, the plugin must skip type analysis and return the source unchanged.

## Goals

- Let callers opt specific `.vue` files in or out of resolver work.
- Keep the default behavior unchanged when `filter` is not provided.
- Keep the API synchronous and small.
- Make the filter available to both path-based and source-based decisions.

## Non-Goals

- async filtering
- glob/pattern helpers in this iteration
- changing non-`.vue` handling

## Design

### Public API

Add `filter` to `VueTypeResolverOptions` and normalize it through existing option normalization.

### Transform behavior

Inside the plugin `transform` hook:

1. keep the existing `.vue` guard
2. keep the existing typed-macro fast path
3. if `filter` exists, call it with `{ id, code }`
4. when it returns `false`, stop and return `null`
5. otherwise continue with the existing parse/analyze/rewrite flow

### Testing

Add integration coverage for:

- a file that matches the filter and is rewritten
- a file that does not match the filter and is left unchanged

### Docs

Update the README usage section with a filter example based on file path matching.
