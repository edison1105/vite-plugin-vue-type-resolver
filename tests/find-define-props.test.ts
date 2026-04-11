import { describe, expect, test } from "vite-plus/test";

import { findDefinePropsCalls } from "../src/sfc/findDefinePropsCalls";
import { parseSfc } from "../src/sfc/parseSfc";

describe("findDefinePropsCalls", () => {
  test("finds direct defineProps<T>() in script setup", () => {
    const source = `
<script setup lang="ts">
import type { Props } from './types'
const props = defineProps<Props>()
</script>
`;

    const sfc = parseSfc("/src/App.vue", source);
    const calls = findDefinePropsCalls(sfc);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      typeText: "Props",
      block: "scriptSetup",
    });
    expect(source.slice(calls[0].callStart, calls[0].callEnd)).toBe("defineProps<Props>()");
    expect(source.slice(calls[0].typeArgStart, calls[0].typeArgEnd)).toBe("Props");
  });

  test("ignores defineProps without a type argument", () => {
    const source = `
<script setup lang="ts">
const props = defineProps()
</script>
`;

    const sfc = parseSfc("/src/App.vue", source);
    const calls = findDefinePropsCalls(sfc);

    expect(calls).toHaveLength(0);
  });

  test("ignores shadowed const arrow bindings named defineProps", () => {
    const source = `
<script setup lang="ts">
const defineProps = <T>() => ({})
defineProps<{ foo: string }>()
</script>
`;

    const sfc = parseSfc("/src/App.vue", source);
    const calls = findDefinePropsCalls(sfc);

    expect(calls).toHaveLength(0);
  });
});
