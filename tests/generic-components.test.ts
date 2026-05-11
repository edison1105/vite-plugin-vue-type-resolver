import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { compileScript, parse as parseSfc } from "@vue/compiler-sfc";
import { describe, expect, test } from "vite-plus/test";

import { vueTypeResolver } from "../src";
import { createFixtureProject } from "./helpers/createFixtureProject";
import { resolveDefineEmitsCase } from "./helpers/resolveDefineEmitsCase";
import { resolveDefinePropsCase } from "./helpers/resolveDefinePropsCase";
import { runPluginTransform } from "./helpers/runPluginTransform";

function normalizeTransformCode(
  result: Awaited<ReturnType<typeof runPluginTransform>>["result"],
  code: string,
): string {
  if (typeof result === "string") {
    return result;
  }

  if (typeof result === "object" && result && "code" in result && typeof result.code === "string") {
    return result.code;
  }

  return code;
}

describe("generic script setup support", () => {
  test("resolves defineProps in generic script setup components", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify(
        {
          compilerOptions: {
            strict: true,
            target: "ES2023",
            module: "ESNext",
            moduleResolution: "Bundler",
            allowArbitraryExtensions: true,
          },
          include: ["src/**/*"],
        },
        null,
        2,
      ),
      "src/App.vue": `<template></template>
<script setup lang="ts" generic="X extends object">
type A = {
  title?: string
  value?: X
}

type B = {
  title?: string
  values?: X[]
}

type Props = A & B
const props = withDefaults(defineProps<Props>(), {
  title: "Test",
})
</script>
`,
    });

    const id = join(project.root, "src/App.vue");
    const source = readFileSync(id, "utf8");
    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
    });
    const { result, warnings } = await runPluginTransform({
      plugin,
      code: source,
      id,
      cwd: project.root,
    });

    const transformed = normalizeTransformCode(result, source);
    const { descriptor } = parseSfc(transformed, { filename: id });
    const compiled = compileScript(descriptor, {
      id: "src/App.vue",
      fs: {
        fileExists: existsSync,
        readFile(file) {
          return readFileSync(file, "utf8");
        },
        realpath: realpathSync,
      },
      inlineTemplate: false,
    }).content;

    expect(warnings).toEqual([]);
    expect(transformed).toMatch(/defineProps<\s*\{/);
    expect(compiled).toContain(`title: { type: String, required: false, default: "Test" }`);
    expect(compiled).toContain(`value: { type: null, required: false }`);
    expect(compiled).toContain(`values: { type: Array, required: false }`);
  });

  test("resolves imported props with constrained and defaulted generic parameters", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetupAttrs: `generic="Row extends object, Key extends keyof Row = keyof Row"`,
      files: {
        "src/types.ts": `
export interface Column<Row, Key extends keyof Row = keyof Row> {
  key: Key
  row?: Row
}

export type TableProps<Row, Key extends keyof Row = keyof Row> = {
  row?: Row
  rows?: Row[]
  columns?: Column<Row, Key>[]
  selectedKey?: Key
}
`,
      },
      scriptSetup: `
import type { TableProps } from "./types"

type Props = TableProps<Row, Key> & {
  title?: string
}

const props = defineProps<Props>()
`,
    });

    expect(result.warnings).toEqual([]);
    expect(result.transformed).toMatch(/defineProps<\s*\{/);
    expect(result.runtimeProps).toEqual({
      columns: { types: ["Array"], required: false, skipCheck: false },
      row: { types: null, required: false, skipCheck: false },
      rows: { types: ["Array"], required: false, skipCheck: false },
      selectedKey: { types: null, required: false, skipCheck: false },
      title: { types: ["String"], required: false, skipCheck: false },
    });
  });

  test("resolves local generic alias variants from the issue report", async () => {
    const cases = [
      `
type A<T> = {
  title?: string
  value?: T
}

type B<T> = {
  title?: string
  values?: T[]
}

type Props = A<X> & B<X>
`,
      `
type A<X> = {
  title?: string
  value?: X
}

type B<X> = {
  title?: string
  values?: X[]
}

type Props = A<X> & B<X>
`,
    ];

    for (const declarations of cases) {
      const result = await resolveDefinePropsCase({
        scriptSetupAttrs: `generic="X extends object"`,
        scriptSetup: `
${declarations}
const props = defineProps<Props>()
`,
      });

      expect(result.warnings).toEqual([]);
      expect(result.runtimeProps).toEqual({
        title: { types: ["String"], required: false, skipCheck: false },
        value: { types: null, required: false, skipCheck: false },
        values: { types: ["Array"], required: false, skipCheck: false },
      });
    }
  });

  test("resolves defineEmits in generic script setup components", async () => {
    const result = await resolveDefineEmitsCase({
      scriptSetupAttrs: `generic="Row extends object, Key extends keyof Row = keyof Row"`,
      scriptSetup: `
type Emits = {
  change: [value: Row]
  select: [row: Row, key: Key]
}

const emit = defineEmits<Emits>()
`,
    });

    expect(result.warnings).toEqual([]);
    expect(result.transformed).toMatch(/defineEmits<\s*\{/);
    expect(result.runtimeEmits).toEqual(["change", "select"]);
  });

  test("falls back when generic parameters determine the root prop keys", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetupAttrs: `generic="Model extends object"`,
      compile: false,
      scriptSetup: `
const props = defineProps<{ [K in keyof Model]: string }>()
`,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Failed to materialize defineProps type");
    expect(result.warnings[0]).toContain("open index signature detected");
    expect(result.transformed).toBe(result.source);
  });
});
