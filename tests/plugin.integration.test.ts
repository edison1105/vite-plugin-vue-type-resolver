import { join } from "node:path";

import { describe, expect, test } from "vite-plus/test";

import { vueTypeResolver } from "../src";
import { createFixtureProject } from "./helpers/createFixtureProject";
import { runPluginTransform } from "./helpers/runPluginTransform";

function normalizeTransformCode(
  result: Awaited<ReturnType<typeof runPluginTransform>>["result"],
  code: string,
) {
  if (typeof result === "string") {
    return result;
  }

  if (typeof result === "object" && result && "code" in result) {
    return result.code;
  }

  return code;
}

describe("vueTypeResolver integration", () => {
  test("rewrites defineEmits overload type arguments into a finite event map", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });

    const code = `
<script setup lang="ts">
type Emits = {
  (e: "change", value: number): void
  (e: "submit"): void
}
const emit = defineEmits<Emits>()
</script>
`;

    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
    });

    const { result, warnings } = await runPluginTransform({
      plugin,
      code,
      id: join(project.root, "src/App.vue"),
    });

    const transformed = normalizeTransformCode(result, code);

    expect(warnings).toHaveLength(0);
    expect(transformed).not.toBe(code);
    expect(transformed).toContain("defineEmits<{");
    expect(transformed).toContain("change: any[]");
    expect(transformed).toContain("submit: any[]");
  });

  test("rewrites imported third-party helper emits types", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "ESNext",
          moduleResolution: "Bundler",
          baseUrl: ".",
        },
        include: ["src/**/*"],
      }),
      "node_modules/vue-component-type-helpers/index.d.ts": `
export type ComponentEmit<T extends abstract new (...args: any[]) => any> =
  InstanceType<T>["$emit"]
`,
      "node_modules/element-plus/index.d.ts": `
export const ElTable: abstract new (...args: any[]) => {
  $emit:
    ((event: "select", selection: unknown[]) => void) &
    ((event: "update:current-page", page: number) => void)
}
`,
    });

    const code = `
<script setup lang="ts">
import { ElTable } from "element-plus"
import type { ComponentEmit } from "vue-component-type-helpers"

type TableEmits = ComponentEmit<typeof ElTable>
const emit = defineEmits<TableEmits>()
</script>
`;

    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
    });

    const { result, warnings } = await runPluginTransform({
      plugin,
      code,
      id: join(project.root, "src/App.vue"),
    });

    const transformed = normalizeTransformCode(result, code);

    expect(warnings).toHaveLength(0);
    expect(transformed).toContain("defineEmits<{");
    expect(transformed).toContain("select: any[]");
    expect(transformed).toContain('"update:current-page": any[]');
  });

  test("warns and leaves defineEmits unchanged when event names are not finite", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });

    const code = `
<script setup lang="ts">
type Emits = (e: string, value: number) => void
const emit = defineEmits<Emits>()
</script>
`;

    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
    });

    const { result, warnings } = await runPluginTransform({
      plugin,
      code,
      id: join(project.root, "src/Fallback.vue"),
    });

    const transformed = normalizeTransformCode(result, code);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Failed to materialize defineEmits type");
    expect(transformed).toBe(code);
    expect(transformed).toContain("defineEmits<Emits>()");
  });

  test("rewrites defineProps type arguments when materialization succeeds", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
      "src/types.ts": `
export interface Props {
  foo: string
  bar?: number
}
`,
    });

    const code = `
<script setup lang="ts">
import type { Props } from './types'
const props = defineProps<Props>()
</script>
`;

    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
    });

    const { result, warnings } = await runPluginTransform({
      plugin,
      code,
      id: join(project.root, "src/App.vue"),
    });

    const transformed = normalizeTransformCode(result, code);

    expect(warnings).toHaveLength(0);
    expect(transformed).not.toBe(code);
    expect(transformed).toContain("defineProps<{");
    expect(transformed).toContain("foo: string");
    expect(transformed).toContain("bar?: number");
    expect(transformed).toContain("import type { Props } from './types'");
  });

  test("warns and leaves the source unchanged on fallback", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });

    const code = `
<script setup lang="ts">
const props = defineProps<Record<string, string>>()
</script>
`;

    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
    });

    const { result, warnings } = await runPluginTransform({
      plugin,
      code,
      id: join(project.root, "src/Fallback.vue"),
    });

    const transformed = normalizeTransformCode(result, code);

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Failed to materialize defineProps type");
    expect(transformed).toBe(code);
    expect(transformed).toContain("defineProps<Record<string, string>>()");
  });

  test("rewrites local typeof-backed props without relying on cwd", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });

    const code = `
<script setup lang="ts">
const theme = "dark" as const
type Props = {
  theme: typeof theme
}
const props = defineProps<Props>()
</script>
`;

    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
    });

    const { result, warnings } = await runPluginTransform({
      plugin,
      code,
      id: join(project.root, "src/LocalTypeof.vue"),
    });

    const transformed = normalizeTransformCode(result, code);

    expect(warnings).toHaveLength(0);
    expect(transformed).not.toBe(code);
    expect(transformed).toContain('theme: "dark"');
    expect(transformed).toContain("defineProps<{");
    expect(transformed).not.toContain("defineProps<Props>()");
  });

  test("automatically resolves referenced app tsconfig when root tsconfig only contains project references", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        files: [],
        references: [{ path: "./tsconfig.app.json" }, { path: "./tsconfig.node.json" }],
      }),
      "tsconfig.app.json": `{
  "compilerOptions": {
    "strict": true,
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["src/**/*"]
}
`,
      "tsconfig.node.json": `{
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler"
  },
  "include": ["vite.config.ts"]
}
`,
      "src/types.ts": `
export interface Props {
  foo: string
  bar?: number
}
`,
    });

    const code = `
<script setup lang="ts">
import type { Props } from './types'
const props = defineProps<Props>()
</script>
`;

    const plugin = vueTypeResolver();

    const { result, warnings } = await runPluginTransform({
      plugin,
      code,
      id: join(project.root, "src/App.vue"),
      cwd: project.root,
    });

    const transformed = normalizeTransformCode(result, code);

    expect(warnings).toHaveLength(0);
    expect(transformed).not.toBe(code);
    expect(transformed).toContain("defineProps<{");
    expect(transformed).toContain("foo: string");
    expect(transformed).toContain("bar?: number");
  });
});
