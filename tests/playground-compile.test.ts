import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

function extractRuntimeEmits(compiled: string): string[] {
  const match = compiled.match(/emits:\s*\[([\s\S]*?)\]/);

  if (!match) {
    return [];
  }

  return [...match[1].matchAll(/"([^"]+)"/g)].map((entry) => entry[1]).sort();
}

async function transformPlaygroundComponent(relativePath: string) {
  return transformComponentInRoot(playgroundRoot, relativePath);
}

async function transformComponentInRoot(root: string, relativePath: string) {
  const id = join(root, relativePath);
  const source = readFileSync(id, "utf8");
  const plugin = vueTypeResolver({ tsconfigPath: join(root, "tsconfig.json") });
  const { result, warnings } = await runPluginTransform({
    plugin,
    code: source,
    id,
    cwd: root,
  });
  const transformed = normalizeTransformCode(result, source);

  return { id, source, transformed, warnings };
}

function compileTransformedComponent(
  root: string,
  id: string,
  relativePath: string,
  transformed: string,
) {
  const { descriptor } = parse(transformed, { filename: id });
  const globalTypeFile = join(root, "src/global-types.d.ts");
  const compiled = compileScript(descriptor, {
    id: relativePath,
    fs: {
      fileExists: existsSync,
      readFile(file) {
        return readFileSync(file, "utf8");
      },
      realpath: realpathSync,
    },
    globalTypeFiles: existsSync(globalTypeFile) ? [globalTypeFile] : [],
    inlineTemplate: false,
  }).content;

  return compiled;
}

function createSpacedPlaygroundRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "vtr playground space case "));

  cpSync(join(playgroundRoot, "src"), join(root, "src"), { recursive: true });
  cpSync(join(playgroundRoot, "package.json"), join(root, "package.json"));
  cpSync(join(playgroundRoot, "tsconfig.json"), join(root, "tsconfig.json"));
  symlinkSync(join(playgroundRoot, "node_modules"), join(root, "node_modules"), "dir");

  return root;
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
      playgroundRoot,
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
      playgroundRoot,
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
      playgroundRoot,
      id,
      "src/components/ThirdPartyCase.vue",
      transformed,
    );
    expectRuntimeProp(compiled, { name: "label", type: "String", required: true });
    expectRuntimeProp(compiled, { name: "size", type: "Number", required: false });
    expectRuntimeProp(compiled, { name: "active", type: "Boolean", required: true });
    expect(compiled).toMatchSnapshot();
  });

  test("imported generic table props compile to expected runtime props", async () => {
    const { id, transformed, warnings } = await transformPlaygroundComponent(
      "src/components/ImportedGenericTableCase.vue",
    );

    expect(warnings).toEqual([]);
    expect(transformed).toMatch(/defineProps<\s*\{/);
    expect(transformed).not.toContain("defineProps<TableProps<");
    expect(transformed).not.toContain("../types/table");
    const compiled = compileTransformedComponent(
      playgroundRoot,
      id,
      "src/components/ImportedGenericTableCase.vue",
      transformed,
    );
    expect(compiled).not.toContain("../types/table");
    expectRuntimeProp(compiled, { name: "dataList", type: "Array", required: true });
    expectRuntimeProp(compiled, { name: "tableList", type: "Array", required: false });
    expectRuntimeProp(compiled, { name: "loading", type: "Boolean", required: false });
    expect(compiled).toMatchSnapshot();
  });

  test("imported generic emits compile to expected runtime emits", async () => {
    const { id, transformed, warnings } = await transformPlaygroundComponent(
      "src/components/ImportedGenericEmitCase.vue",
    );

    expect(warnings).toEqual([]);
    expect(transformed).toMatch(/defineEmits<\s*\{/);
    expect(transformed).not.toContain("defineEmits<TableEmits>()");
    const compiled = compileTransformedComponent(
      playgroundRoot,
      id,
      "src/components/ImportedGenericEmitCase.vue",
      transformed,
    );
    expect(extractRuntimeEmits(compiled)).toEqual([
      "cell-click",
      "cell-contextmenu",
      "cell-dblclick",
      "cell-mouse-enter",
      "cell-mouse-leave",
      "current-change",
      "expand-change",
      "filter-change",
      "header-click",
      "header-contextmenu",
      "header-dragend",
      "row-click",
      "row-contextmenu",
      "row-dblclick",
      "scroll",
      "select",
      "select-all",
      "selection-change",
      "sort-change",
    ]);
    expect(compiled).toMatchSnapshot();
  });

  test("imported generic table props still resolve from a project path with spaces", async () => {
    const spacedRoot = createSpacedPlaygroundRoot();

    try {
      const { id, transformed, warnings } = await transformComponentInRoot(
        spacedRoot,
        "src/components/ImportedGenericTableCase.vue",
      );

      expect(warnings).toEqual([]);
      expect(transformed).toMatch(/defineProps<\s*\{/);
      const compiled = compileTransformedComponent(
        spacedRoot,
        id,
        "src/components/ImportedGenericTableCase.vue",
        transformed,
      );
      expectRuntimeProp(compiled, { name: "dataList", type: "Array", required: true });
      expectRuntimeProp(compiled, { name: "tableList", type: "Array", required: false });
      expectRuntimeProp(compiled, { name: "loading", type: "Boolean", required: false });
    } finally {
      rmSync(spacedRoot, { recursive: true, force: true });
    }
  });

  test("imported generic table props stay resolved after component changes from a path with spaces", async () => {
    const spacedRoot = createSpacedPlaygroundRoot();
    const plugin = vueTypeResolver({
      tsconfigPath: join(spacedRoot, "tsconfig.json"),
    });
    const buildStart = getHookHandler(plugin.buildStart);
    const transform = getHookHandler(plugin.transform);
    const buildEnd = getHookHandler(plugin.buildEnd);
    const watchChange = getHookHandler(
      plugin.watchChange as HookLike<(id: string, event?: unknown) => void> | undefined,
    );
    const componentPath = join(spacedRoot, "src/components/ImportedGenericTableCase.vue");
    const warnings: string[] = [];
    const source = readFileSync(componentPath, "utf8");

    try {
      await buildStart?.apply({} as never, [{}] as Parameters<NonNullable<typeof buildStart>>);

      const firstResult = await transform?.apply(
        {
          warn(message: string) {
            warnings.push(message);
          },
        } as never,
        [source, componentPath],
      );
      const firstTransformed = normalizeTransformCode(firstResult, source);
      const firstCompiled = compileTransformedComponent(
        spacedRoot,
        componentPath,
        "src/components/ImportedGenericTableCase.vue",
        firstTransformed,
      );
      expectRuntimeProp(firstCompiled, { name: "dataList", type: "Array", required: true });
      expectRuntimeProp(firstCompiled, { name: "tableList", type: "Array", required: false });
      expectRuntimeProp(firstCompiled, { name: "loading", type: "Boolean", required: false });

      writeFileSync(componentPath, `${source}\n<!-- touched -->\n`);
      watchChange?.apply({} as never, [componentPath]);
      const updatedSource = readFileSync(componentPath, "utf8");

      const secondResult = await transform?.apply(
        {
          warn(message: string) {
            warnings.push(message);
          },
        } as never,
        [updatedSource, componentPath],
      );
      const secondTransformed = normalizeTransformCode(secondResult, updatedSource);
      const secondCompiled = compileTransformedComponent(
        spacedRoot,
        componentPath,
        "src/components/ImportedGenericTableCase.vue",
        secondTransformed,
      );
      expectRuntimeProp(secondCompiled, { name: "dataList", type: "Array", required: true });
      expectRuntimeProp(secondCompiled, { name: "tableList", type: "Array", required: false });
      expectRuntimeProp(secondCompiled, { name: "loading", type: "Boolean", required: false });
      expect(warnings).toEqual([]);
    } finally {
      await buildEnd?.apply({} as never, []);
      rmSync(spacedRoot, { recursive: true, force: true });
    }
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
      expect(bundle).toContain("Imported Generic Table Case");
      expect(bundle).toContain("Imported Generic Emit Case");
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
        "src/components/ImportedGenericTableCase.vue",
        "src/components/ImportedGenericEmitCase.vue",
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
        currentMode: "full",
        incrementalAttempts: 5,
        incrementalSuccesses: 4,
        fullRebuilds: 1,
        fallbacks: {
          sourceFileNotFound: 0,
          syntheticTargetTypeNotResolved: 1,
        },
      });
    } finally {
      console.info = originalInfo;
      process.chdir(originalCwd);
    }
  });
});
