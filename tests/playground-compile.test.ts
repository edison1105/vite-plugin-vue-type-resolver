import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { compileScript, parse } from "@vue/compiler-sfc";
import { build } from "vite-plus";
import { describe, expect, test } from "vite-plus/test";

import { vueTypeResolver } from "../src";
import { runPluginTransform } from "./helpers/runPluginTransform";

const playgroundRoot = fileURLToPath(new URL("../playground/", import.meta.url));
const playgroundTsconfigPath = join(playgroundRoot, "tsconfig.json");

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

function expectRuntimeProp(
  compiled: string,
  input: { name: string; type: string; required: boolean },
) {
  const expected = new RegExp(
    `${input.name}:\\s*\\{\\s*type:\\s*${input.type},\\s*required:\\s*${
      input.required ? "true" : "false"
    }\\s*\\}`,
  );

  expect(compiled).toMatch(expected);
}

async function transformPlaygroundComponent(relativePath: string) {
  const id = join(playgroundRoot, relativePath);
  const source = readFileSync(id, "utf8");
  const plugin = vueTypeResolver({ tsconfigPath: playgroundTsconfigPath });
  const { result, warnings } = await runPluginTransform({
    plugin,
    code: source,
    id,
    cwd: playgroundRoot,
  });
  const transformed = normalizeTransformCode(result, source);

  return { id, source, transformed, warnings };
}

function compileTransformedComponent(id: string, relativePath: string, transformed: string) {
  const { descriptor } = parse(transformed, { filename: id });
  const compiled = compileScript(descriptor, {
    id: relativePath,
    fs: {
      fileExists: existsSync,
      readFile(file) {
        return readFileSync(file, "utf8");
      },
      realpath: realpathSync,
    },
    globalTypeFiles: [join(playgroundRoot, "src/global-types.d.ts")],
    inlineTemplate: false,
  }).content;

  return compiled;
}

describe("playground compile output", () => {
  test("local complex props compile to expected runtime props", async () => {
    const { id, transformed, warnings } = await transformPlaygroundComponent(
      "src/components/LocalComplexCase.vue",
    );

    expect(warnings).toEqual([]);
    expect(transformed).toMatch(/defineProps<\s*\{/);
    expect(transformed).not.toContain("defineProps<Readonly<");
    const compiled = compileTransformedComponent(
      id,
      "src/components/LocalComplexCase.vue",
      transformed,
    );
    expectRuntimeProp(compiled, { name: "title", type: "String", required: true });
    expectRuntimeProp(compiled, { name: "pinned", type: "Boolean", required: true });
    expectRuntimeProp(compiled, { name: "count", type: "Number", required: false });
    expectRuntimeProp(compiled, { name: "mode", type: "String", required: true });
    expect(compiled).toMatchSnapshot();
  });

  test("global ambient props compile to expected runtime props", async () => {
    const { id, transformed, warnings } = await transformPlaygroundComponent(
      "src/components/GlobalAmbientCase.vue",
    );

    expect(warnings).toEqual([]);
    expect(transformed).toMatch(/defineProps<\s*\{/);
    expect(transformed).not.toContain("GlobalAmbientProps");
    const compiled = compileTransformedComponent(
      id,
      "src/components/GlobalAmbientCase.vue",
      transformed,
    );
    expectRuntimeProp(compiled, { name: "tone", type: "String", required: true });
    expectRuntimeProp(compiled, { name: "version", type: "Number", required: false });
    expectRuntimeProp(compiled, { name: "pinned", type: "Boolean", required: false });
    expect(compiled).toMatchSnapshot();
  });

  test("third-party utility props compile to expected runtime props", async () => {
    const { id, transformed, warnings } = await transformPlaygroundComponent(
      "src/components/ThirdPartyCase.vue",
    );

    expect(warnings).toEqual([]);
    expect(transformed).toMatch(/defineProps<\s*\{/);
    expect(transformed).not.toContain("defineProps<Simplify<");
    const compiled = compileTransformedComponent(
      id,
      "src/components/ThirdPartyCase.vue",
      transformed,
    );
    expectRuntimeProp(compiled, { name: "label", type: "String", required: true });
    expectRuntimeProp(compiled, { name: "size", type: "Number", required: false });
    expectRuntimeProp(compiled, { name: "active", type: "Boolean", required: true });
    expect(compiled).toMatchSnapshot();
  });

  test("the real playground build succeeds with the Vue plugin chain", async () => {
    const outDir = mkdtempSync(join(tmpdir(), "vtr-playground-dist-"));
    const originalCwd = process.cwd();

    try {
      process.chdir(playgroundRoot);
      await build({
        root: playgroundRoot,
        configFile: join(playgroundRoot, "vite.config.ts"),
        logLevel: "silent",
        build: {
          outDir,
          emptyOutDir: true,
          minify: false,
        },
      });

      const assetsDir = join(outDir, "assets");
      const bundle = readdirSync(assetsDir)
        .filter((file) => file.endsWith(".js"))
        .map((file) => readFileSync(join(assetsDir, file), "utf8"))
        .join("\n");

      expect(bundle).toContain("Local Complex Case");
      expect(bundle).toContain("Global Ambient Case");
      expect(bundle).toContain("Third Party Case");
    } finally {
      process.chdir(originalCwd);
      rmSync(outDir, { recursive: true, force: true });
    }
  });

  test("playground complex cases stay incremental in one shared session", async () => {
    const plugin = vueTypeResolver({
      tsconfigPath: playgroundTsconfigPath,
      logSnapshotStats: true,
    });
    const buildStart = getHookHandler(plugin.buildStart);
    const transform = getHookHandler(plugin.transform);
    const buildEnd = getHookHandler(plugin.buildEnd);
    const warnings: string[] = [];
    const originalCwd = process.cwd();
    const originalInfo = console.info;
    const infoCalls: unknown[][] = [];

    console.info = (...args: unknown[]) => {
      infoCalls.push(args);
    };
    process.chdir(playgroundRoot);

    try {
      await buildStart?.apply({} as never, [{}] as Parameters<NonNullable<typeof buildStart>>);

      for (const relativePath of [
        "src/components/LocalComplexCase.vue",
        "src/components/GlobalAmbientCase.vue",
        "src/components/ThirdPartyCase.vue",
      ]) {
        const id = join(playgroundRoot, relativePath);
        const source = readFileSync(id, "utf8");

        await transform?.apply(
          {
            warn(message: string) {
              warnings.push(message);
            },
          } as never,
          [source, id],
        );
      }

      await buildEnd?.apply({} as never, []);

      expect(warnings).toEqual([]);
      expect(infoCalls).toHaveLength(1);
      expect(infoCalls[0][1]).toEqual({
        currentMode: "incremental",
        incrementalAttempts: 3,
        incrementalSuccesses: 3,
        fullRebuilds: 0,
        fallbacks: {
          sourceFileNotFound: 0,
          syntheticTargetTypeNotResolved: 0,
        },
      });
    } finally {
      console.info = originalInfo;
      process.chdir(originalCwd);
    }
  });
});
