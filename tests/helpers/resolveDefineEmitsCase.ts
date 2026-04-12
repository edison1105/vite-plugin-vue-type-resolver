import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { parse as parseScript } from "@babel/parser";
import { compileScript, parse as parseSfc } from "@vue/compiler-sfc";

import { vueTypeResolver } from "../../src";
import { createFixtureProject } from "./createFixtureProject";
import { runPluginTransform } from "./runPluginTransform";

export interface ResolveDefineEmitsCaseResult {
  root: string;
  source: string;
  transformed: string;
  compiled: string;
  warnings: string[];
  runtimeEmits: string[];
}

interface ResolveDefineEmitsCaseInput {
  scriptSetup: string;
  script?: string;
  files?: Record<string, string>;
  compilerOptions?: Record<string, unknown>;
  compile?: boolean;
}

interface LocalObjectProperty {
  type: "ObjectProperty";
  key: unknown;
  value: unknown;
}

interface LocalObjectExpression {
  type: "ObjectExpression";
  properties: unknown[];
}

interface LocalArrayExpression {
  type: "ArrayExpression";
  elements: unknown[];
}

interface LocalCallExpression {
  type: "CallExpression";
  arguments: unknown[];
}

interface LocalExportDefaultDeclaration {
  type: "ExportDefaultDeclaration";
  declaration: unknown;
}

interface LocalIdentifier {
  type: "Identifier";
  name: string;
}

interface LocalStringLiteral {
  type: "StringLiteral";
  value: string;
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

function isObjectExpression(node: unknown): node is LocalObjectExpression {
  return (
    !!node &&
    typeof node === "object" &&
    (node as LocalObjectExpression).type === "ObjectExpression"
  );
}

function isObjectProperty(node: unknown): node is LocalObjectProperty {
  return (
    !!node && typeof node === "object" && (node as LocalObjectProperty).type === "ObjectProperty"
  );
}

function isArrayExpression(node: unknown): node is LocalArrayExpression {
  return (
    !!node && typeof node === "object" && (node as LocalArrayExpression).type === "ArrayExpression"
  );
}

function isCallExpression(node: unknown): node is LocalCallExpression {
  return (
    !!node && typeof node === "object" && (node as LocalCallExpression).type === "CallExpression"
  );
}

function isIdentifier(node: unknown): node is LocalIdentifier {
  return !!node && typeof node === "object" && (node as LocalIdentifier).type === "Identifier";
}

function isStringLiteral(node: unknown): node is LocalStringLiteral {
  return (
    !!node && typeof node === "object" && (node as LocalStringLiteral).type === "StringLiteral"
  );
}

function getObjectProperty(
  objectExpression: LocalObjectExpression,
  propertyName: string,
): LocalObjectProperty | undefined {
  return objectExpression.properties.find((property) => {
    if (!isObjectProperty(property)) {
      return false;
    }

    if (isIdentifier(property.key)) {
      return property.key.name === propertyName;
    }

    if (isStringLiteral(property.key)) {
      return property.key.value === propertyName;
    }

    return false;
  }) as LocalObjectProperty | undefined;
}

function extractRuntimeEmits(compiled: string): string[] {
  const ast = parseScript(compiled, {
    sourceType: "module",
    plugins: ["typescript"],
  });

  const exportDefault = ast.program.body.find(
    (node) =>
      !!node &&
      typeof node === "object" &&
      (node as LocalExportDefaultDeclaration).type === "ExportDefaultDeclaration",
  ) as LocalExportDefaultDeclaration | undefined;

  if (!exportDefault || !isCallExpression(exportDefault.declaration)) {
    throw new Error("compiled output did not contain an export default defineComponent call");
  }

  const optionsObject = exportDefault.declaration.arguments[0];
  if (!isObjectExpression(optionsObject)) {
    throw new Error("compiled component options were not an object expression");
  }

  const emitsProperty = getObjectProperty(optionsObject, "emits");
  if (!emitsProperty || !isArrayExpression(emitsProperty.value)) {
    return [];
  }

  return emitsProperty.value.elements
    .filter((element): element is LocalStringLiteral => isStringLiteral(element))
    .map((element) => element.value)
    .sort();
}

function collectGlobalTypeFiles(root: string, directory = root): string[] {
  const files: string[] = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = join(directory, entry.name);
    if (entry.name === "node_modules") {
      continue;
    }

    if (entry.isDirectory()) {
      files.push(...collectGlobalTypeFiles(root, absolutePath));
      continue;
    }

    if (entry.isFile() && absolutePath.endsWith(".d.ts")) {
      files.push(absolutePath);
    }
  }

  return files.sort();
}

export function compileDefineEmitsCase(input: { root: string; transformed: string }): string {
  const id = join(input.root, "src/App.vue");
  const { descriptor } = parseSfc(input.transformed, { filename: id });

  return compileScript(descriptor, {
    id: "src/App.vue",
    fs: {
      fileExists: existsSync,
      readFile(file) {
        return readFileSync(file, "utf8");
      },
      realpath: realpathSync,
    },
    globalTypeFiles: collectGlobalTypeFiles(input.root),
    inlineTemplate: false,
  }).content;
}

export async function resolveDefineEmitsCase(
  input: ResolveDefineEmitsCaseInput,
): Promise<ResolveDefineEmitsCaseResult> {
  const filename = "src/App.vue";
  const source = [
    input.script ? `<script lang="ts">\n${input.script}\n</script>` : "",
    `<script setup lang="ts">\n${input.scriptSetup}\n</script>`,
    "",
  ].join("\n");
  const projectFiles = {
    "tsconfig.json": JSON.stringify(
      {
        compilerOptions: {
          strict: true,
          target: "ES2023",
          module: "ESNext",
          moduleResolution: "Bundler",
          allowArbitraryExtensions: true,
          ...input.compilerOptions,
        },
        include: ["src/**/*"],
      },
      null,
      2,
    ),
    "src/vue-shim.d.ts": `
declare module "*.vue" {
  import type { DefineComponent } from "vue";
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>;
  export default component;
}
`,
    [filename]: source,
    ...input.files,
  };

  const project = createFixtureProject(projectFiles);
  const id = join(project.root, filename);
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
  let compiled = "";
  let runtimeEmits: string[] = [];

  if (input.compile !== false) {
    compiled = compileDefineEmitsCase({
      root: project.root,
      transformed,
    });
    runtimeEmits = extractRuntimeEmits(compiled);
  }

  return {
    root: project.root,
    source,
    transformed,
    compiled,
    warnings,
    runtimeEmits,
  };
}
