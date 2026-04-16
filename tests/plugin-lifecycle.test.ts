import { join } from "node:path";

import { describe, expect, test } from "vite-plus/test";

import { vueTypeResolver } from "../src";
import {
  TsgoSession,
  type DescribeRootTypeRequest,
  type DescribeRootTypeResult,
} from "../src/tsgo/session";
import { createFixtureProject } from "./helpers/createFixtureProject";

type HookLike<T extends (...args: never[]) => unknown> = T | { handler: T };

function getHookHandler<T extends (...args: never[]) => unknown>(
  hook: HookLike<T> | null | undefined,
): T | undefined {
  if (typeof hook === "function") {
    return hook;
  }

  if (hook && typeof hook === "object" && "handler" in hook && typeof hook.handler === "function") {
    return hook.handler;
  }

  return undefined;
}

function normalizeTransformCode(result: unknown, code: string) {
  if (typeof result === "string") {
    return result;
  }

  if (typeof result === "object" && result && "code" in result) {
    return result.code;
  }

  return code;
}

type DescribeRootTypeMethod = (
  this: TsgoSession,
  request: DescribeRootTypeRequest,
) => Promise<DescribeRootTypeResult>;

describe("vueTypeResolver lifecycle", () => {
  test("skips tsgo setup for SFCs without typed defineProps", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });

    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
    });

    const buildStart = getHookHandler(plugin.buildStart);
    const transform = getHookHandler(plugin.transform);
    const buildEnd = getHookHandler(plugin.buildEnd);

    const code = `
<script setup>
const props = defineProps({
  foo: String,
})
</script>
`;

    const warnings: string[] = [];
    const warnContext = {
      warn(message: string) {
        warnings.push(message);
      },
    };

    const originalClose = Object.getOwnPropertyDescriptor(TsgoSession.prototype, "close")?.value;
    let closeCount = 0;

    if (!originalClose) {
      throw new Error("TsgoSession.close is unavailable");
    }

    TsgoSession.prototype.close = async function patchedClose(this: TsgoSession) {
      closeCount += 1;
      return Reflect.apply(originalClose, this, []);
    };

    try {
      await buildStart?.apply({} as never, [{}] as Parameters<NonNullable<typeof buildStart>>);

      const result = await transform?.apply(warnContext as never, [
        code,
        join(project.root, "src/RuntimeProps.vue"),
      ]);

      expect(result).toBeNull();
      expect(warnings).toHaveLength(0);

      await buildEnd?.apply({} as never, []);

      expect(closeCount).toBe(0);
    } finally {
      TsgoSession.prototype.close = originalClose;
    }
  });

  test("skips tsgo setup when the filter rejects a typed SFC", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });

    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
      filter: ({ id }) => id.endsWith("Enabled.vue"),
    });

    const buildStart = getHookHandler(plugin.buildStart);
    const transform = getHookHandler(plugin.transform);
    const buildEnd = getHookHandler(plugin.buildEnd);

    const code = `
<script setup lang="ts">
type Props = {
  foo: string
}
const props = defineProps<Props>()
</script>
`;

    const warnings: string[] = [];
    const warnContext = {
      warn(message: string) {
        warnings.push(message);
      },
    };

    const originalClose = Object.getOwnPropertyDescriptor(TsgoSession.prototype, "close")?.value;
    let closeCount = 0;

    if (!originalClose) {
      throw new Error("TsgoSession.close is unavailable");
    }

    TsgoSession.prototype.close = async function patchedClose(this: TsgoSession) {
      closeCount += 1;
      return Reflect.apply(originalClose, this, []);
    };

    try {
      await buildStart?.apply({} as never, [{}] as Parameters<NonNullable<typeof buildStart>>);

      const result = await transform?.apply(warnContext as never, [
        code,
        join(project.root, "src/Disabled.vue"),
      ]);

      expect(result).toBeNull();
      expect(warnings).toHaveLength(0);

      await buildEnd?.apply({} as never, []);

      expect(closeCount).toBe(0);
    } finally {
      TsgoSession.prototype.close = originalClose;
    }
  });

  test("caches repeated transforms for unchanged SFC source", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });

    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
    });

    const buildStart = getHookHandler(plugin.buildStart);
    const transform = getHookHandler(plugin.transform);
    const buildEnd = getHookHandler(plugin.buildEnd);

    const code = `
<script setup lang="ts">
type Props = {
  foo: string
}
const props = defineProps<Props>()
</script>
`;

    const warnings: string[] = [];
    const warnContext = {
      warn(message: string) {
        warnings.push(message);
      },
    };

    const originalDescribe = Object.getOwnPropertyDescriptor(
      TsgoSession.prototype,
      "describeRootType",
    )?.value as DescribeRootTypeMethod | undefined;
    let describeCount = 0;

    if (!originalDescribe) {
      throw new Error("TsgoSession.describeRootType is unavailable");
    }

    TsgoSession.prototype.describeRootType = async function patchedDescribeRootType(
      this: TsgoSession,
      request: DescribeRootTypeRequest,
    ): Promise<DescribeRootTypeResult> {
      describeCount += 1;
      return Reflect.apply(originalDescribe, this, [request]) as Promise<DescribeRootTypeResult>;
    };

    try {
      await buildStart?.apply({} as never, [{}] as Parameters<NonNullable<typeof buildStart>>);

      const firstResult = await transform?.apply(warnContext as never, [
        code,
        join(project.root, "src/Cached.vue"),
      ]);
      const secondResult = await transform?.apply(warnContext as never, [
        code,
        join(project.root, "src/Cached.vue"),
      ]);

      expect(warnings).toHaveLength(0);
      expect(describeCount).toBe(1);
      expect(normalizeTransformCode(firstResult, code)).toContain("foo: string");
      expect(normalizeTransformCode(secondResult, code)).toContain("foo: string");

      await buildEnd?.apply({} as never, []);
    } finally {
      TsgoSession.prototype.describeRootType = originalDescribe;
    }
  });

  test("reuses one tsgo session across multiple transforms in the same build", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });

    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
    });

    const buildStart = getHookHandler(plugin.buildStart);
    const transform = getHookHandler(plugin.transform);
    const buildEnd = getHookHandler(plugin.buildEnd);

    const firstCode = `
<script setup lang="ts">
type Props = {
  foo: string
}
const props = defineProps<Props>()
</script>
`;

    const secondCode = `
<script setup lang="ts">
type Props = {
  bar?: number
}
const props = defineProps<Props>()
</script>
`;

    const warnings: string[] = [];
    const warnContext = {
      warn(message: string) {
        warnings.push(message);
      },
    };

    const originalClose = Object.getOwnPropertyDescriptor(TsgoSession.prototype, "close")?.value;
    let closeCount = 0;

    if (!originalClose) {
      throw new Error("TsgoSession.close is unavailable");
    }

    TsgoSession.prototype.close = async function patchedClose(this: TsgoSession) {
      closeCount += 1;
      return Reflect.apply(originalClose, this, []);
    };

    try {
      await buildStart?.apply({} as never, [{}] as Parameters<NonNullable<typeof buildStart>>);

      const firstResult = await transform?.apply(warnContext as never, [
        firstCode,
        join(project.root, "src/First.vue"),
      ]);
      const secondResult = await transform?.apply(warnContext as never, [
        secondCode,
        join(project.root, "src/Second.vue"),
      ]);

      expect(warnings).toHaveLength(0);
      expect(closeCount).toBe(0);
      expect(normalizeTransformCode(firstResult, firstCode)).toContain("foo: string");
      expect(normalizeTransformCode(secondResult, secondCode)).toContain("bar?: number");

      await buildEnd?.apply({} as never, []);

      expect(closeCount).toBe(1);
    } finally {
      TsgoSession.prototype.close = originalClose;
    }
  });

  test("clears cached transforms when watched files change", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });

    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
    });

    const buildStart = getHookHandler(plugin.buildStart);
    const transform = getHookHandler(plugin.transform);
    const watchChange = getHookHandler(plugin.watchChange);
    const buildEnd = getHookHandler(plugin.buildEnd);

    const code = `
<script setup lang="ts">
type Props = {
  foo: string
}
const props = defineProps<Props>()
</script>
`;

    const warnings: string[] = [];
    const warnContext = {
      warn(message: string) {
        warnings.push(message);
      },
    };

    const originalDescribe = Object.getOwnPropertyDescriptor(
      TsgoSession.prototype,
      "describeRootType",
    )?.value as DescribeRootTypeMethod | undefined;
    let describeCount = 0;

    if (!originalDescribe) {
      throw new Error("TsgoSession.describeRootType is unavailable");
    }

    TsgoSession.prototype.describeRootType = async function patchedDescribeRootType(
      this: TsgoSession,
      request: DescribeRootTypeRequest,
    ): Promise<DescribeRootTypeResult> {
      describeCount += 1;
      return Reflect.apply(originalDescribe, this, [request]) as Promise<DescribeRootTypeResult>;
    };

    try {
      await buildStart?.apply({} as never, [{}] as Parameters<NonNullable<typeof buildStart>>);

      await transform?.apply(warnContext as never, [code, join(project.root, "src/Cached.vue")]);
      expect(describeCount).toBe(1);

      await watchChange?.apply({} as never, [
        join(project.root, "src/types.ts"),
        { event: "update" },
      ]);

      await transform?.apply(warnContext as never, [code, join(project.root, "src/Cached.vue")]);

      expect(warnings).toHaveLength(0);
      expect(describeCount).toBe(2);

      await buildEnd?.apply({} as never, []);
    } finally {
      TsgoSession.prototype.describeRootType = originalDescribe;
    }
  });

  test("keeps cached transforms when an unrelated vue file changes", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });

    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
    });

    const buildStart = getHookHandler(plugin.buildStart);
    const transform = getHookHandler(plugin.transform);
    const watchChange = getHookHandler(plugin.watchChange);
    const buildEnd = getHookHandler(plugin.buildEnd);

    const code = `
<script setup lang="ts">
type Props = {
  foo: string
}
const props = defineProps<Props>()
</script>
`;

    const warnings: string[] = [];
    const warnContext = {
      warn(message: string) {
        warnings.push(message);
      },
    };

    const originalDescribe = Object.getOwnPropertyDescriptor(
      TsgoSession.prototype,
      "describeRootType",
    )?.value as DescribeRootTypeMethod | undefined;
    let describeCount = 0;

    if (!originalDescribe) {
      throw new Error("TsgoSession.describeRootType is unavailable");
    }

    TsgoSession.prototype.describeRootType = async function patchedDescribeRootType(
      this: TsgoSession,
      request: DescribeRootTypeRequest,
    ): Promise<DescribeRootTypeResult> {
      describeCount += 1;
      return Reflect.apply(originalDescribe, this, [request]) as Promise<DescribeRootTypeResult>;
    };

    try {
      await buildStart?.apply({} as never, [{}] as Parameters<NonNullable<typeof buildStart>>);

      await transform?.apply(warnContext as never, [code, join(project.root, "src/Cached.vue")]);
      expect(describeCount).toBe(1);

      await watchChange?.apply({} as never, [
        join(project.root, "src/Other.vue"),
        { event: "update" },
      ]);

      await transform?.apply(warnContext as never, [code, join(project.root, "src/Cached.vue")]);

      expect(warnings).toHaveLength(0);
      expect(describeCount).toBe(1);

      await buildEnd?.apply({} as never, []);
    } finally {
      TsgoSession.prototype.describeRootType = originalDescribe;
    }
  });

  test("refreshes type-driven output after a non-vue dependency changes", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
      "src/types.ts": `
export interface Props {
  foo: string
}
`,
    });

    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
    });

    const buildStart = getHookHandler(plugin.buildStart);
    const transform = getHookHandler(plugin.transform);
    const watchChange = getHookHandler(plugin.watchChange);
    const buildEnd = getHookHandler(plugin.buildEnd);

    const code = `
<script setup lang="ts">
import type { Props } from './types'
const props = defineProps<Props>()
</script>
`;

    const warnings: string[] = [];
    const warnContext = {
      warn(message: string) {
        warnings.push(message);
      },
    };

    try {
      await buildStart?.apply({} as never, [{}] as Parameters<NonNullable<typeof buildStart>>);

      const firstResult = await transform?.apply(warnContext as never, [
        code,
        join(project.root, "src/App.vue"),
      ]);

      project.write(
        "src/types.ts",
        `
export interface Props {
  foo: number
}
`,
      );

      await watchChange?.apply({} as never, [
        join(project.root, "src/types.ts"),
        { event: "update" },
      ]);

      const secondResult = await transform?.apply(warnContext as never, [
        code,
        join(project.root, "src/App.vue"),
      ]);

      expect(warnings).toHaveLength(0);
      expect(normalizeTransformCode(firstResult, code)).toContain("foo: string");
      expect(normalizeTransformCode(secondResult, code)).toContain("foo: number");

      await buildEnd?.apply({} as never, []);
    } finally {
      // no-op
    }
  });

  test("logs snapshot stats when enabled", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });

    const plugin = vueTypeResolver({
      tsconfigPath: join(project.root, "tsconfig.json"),
      logSnapshotStats: true,
    });

    const buildStart = getHookHandler(plugin.buildStart);
    const transform = getHookHandler(plugin.transform);
    const buildEnd = getHookHandler(plugin.buildEnd);

    const code = `
<script setup lang="ts">
type Props = {
  foo: string
}
const props = defineProps<Props>()
</script>
`;

    const warnings: string[] = [];
    const warnContext = {
      warn(message: string) {
        warnings.push(message);
      },
    };

    const originalInfo = console.info;
    const infoCalls: unknown[][] = [];
    console.info = (...args: unknown[]) => {
      infoCalls.push(args);
    };

    try {
      await buildStart?.apply({} as never, [{}] as Parameters<NonNullable<typeof buildStart>>);

      await transform?.apply(warnContext as never, [code, join(project.root, "src/App.vue")]);
      await buildEnd?.apply({} as never, []);

      expect(warnings).toHaveLength(0);
      expect(infoCalls).toHaveLength(1);
      expect(infoCalls[0][0]).toBe("[vite-plugin-vue-type-resolver] tsgo snapshot stats");
      expect(infoCalls[0][1]).toEqual({
        currentMode: "incremental",
        incrementalAttempts: 1,
        incrementalSuccesses: 1,
        fullRebuilds: 0,
        fallbacks: {
          sourceFileNotFound: 0,
          syntheticTargetTypeNotResolved: 0,
        },
      });
    } finally {
      console.info = originalInfo;
    }
  });
});
