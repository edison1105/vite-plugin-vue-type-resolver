import type { FallbackReason } from "./materialize/types";

const fallbackMessages: Record<FallbackReason, string> = {
  "open-index-signature": "open index signature detected in root props type",
  "non-object-root": "root defineProps type is not a finite object",
  "unresolved-property-type": "a root property type could not be resolved safely",
  "recursive-limit": "recursive type expansion exceeded the configured depth limit",
  "unsupported-key": "a property key could not be printed as a stable identifier",
};

export function formatFallbackWarning(file: string, reason: FallbackReason): string {
  return [
    `[vite-plugin-vue-type-resolver] Failed to materialize defineProps type in ${file}:`,
    `${fallbackMessages[reason]}.`,
    "Falling back to Vue's default type resolution.",
  ].join("\n");
}
