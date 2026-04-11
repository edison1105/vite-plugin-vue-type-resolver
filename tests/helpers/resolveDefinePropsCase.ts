import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { parse as parseScript } from "@babel/parser";
import { compileScript, parse as parseSfc } from "@vue/compiler-sfc";

import { vueTypeResolver } from "../../src";
import { createFixtureProject } from "./createFixtureProject";
import { runPluginTransform } from "./runPluginTransform";

export interface RuntimePropInfo {
  required: boolean;
  skipCheck: boolean;
  types: string[] | null;
}

export interface ResolveDefinePropsCaseResult {
  root: string;
  source: string;
  transformed: string;
  compiled: string;
  warnings: string[];
  runtimeProps: Record<string, RuntimePropInfo>;
}

interface ResolveDefinePropsCaseInput {
  scriptSetup: string;
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

interface LocalIdentifier {
  type: "Identifier";
  name: string;
}

interface LocalStringLiteral {
  type: "StringLiteral";
  value: string;
}

interface LocalNumericLiteral {
  type: "NumericLiteral";
  value: number;
}

interface LocalBooleanLiteral {
  type: "BooleanLiteral";
  value: boolean;
}

interface LocalNullLiteral {
  type: "NullLiteral";
}

interface LocalCallExpression {
  type: "CallExpression";
  arguments: unknown[];
}

interface LocalExportDefaultDeclaration {
  type: "ExportDefaultDeclaration";
  declaration: unknown;
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

function isIdentifier(node: unknown): node is LocalIdentifier {
  return !!node && typeof node === "object" && (node as LocalIdentifier).type === "Identifier";
}

function isStringLiteral(node: unknown): node is LocalStringLiteral {
  return (
    !!node && typeof node === "object" && (node as LocalStringLiteral).type === "StringLiteral"
  );
}

function isNumericLiteral(node: unknown): node is LocalNumericLiteral {
  return (
    !!node && typeof node === "object" && (node as LocalNumericLiteral).type === "NumericLiteral"
  );
}

function isBooleanLiteral(node: unknown): node is LocalBooleanLiteral {
  return (
    !!node && typeof node === "object" && (node as LocalBooleanLiteral).type === "BooleanLiteral"
  );
}

function isNullLiteral(node: unknown): node is LocalNullLiteral {
  return !!node && typeof node === "object" && (node as LocalNullLiteral).type === "NullLiteral";
}

function isCallExpression(node: unknown): node is LocalCallExpression {
  return (
    !!node && typeof node === "object" && (node as LocalCallExpression).type === "CallExpression"
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

function readPropertyKey(key: unknown): string | null {
  if (isIdentifier(key)) {
    return key.name;
  }

  if (isStringLiteral(key)) {
    return key.value;
  }

  if (isNumericLiteral(key)) {
    return String(key.value);
  }

  return null;
}

function readRuntimeTypes(value: unknown): string[] | null {
  if (isNullLiteral(value)) {
    return null;
  }

  if (isIdentifier(value)) {
    return [value.name];
  }

  if (isArrayExpression(value)) {
    return value.elements
      .filter((element): element is LocalIdentifier => isIdentifier(element))
      .map((element) => element.name)
      .sort();
  }

  return null;
}

function extractRuntimeProps(compiled: string): Record<string, RuntimePropInfo> {
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

  const propsProperty = getObjectProperty(optionsObject, "props");
  if (!propsProperty || !isObjectExpression(propsProperty.value)) {
    return {};
  }

  const props: Record<string, RuntimePropInfo> = {};

  for (const property of propsProperty.value.properties) {
    if (!isObjectProperty(property)) {
      continue;
    }

    const propName = readPropertyKey(property.key);
    if (!propName || !isObjectExpression(property.value)) {
      continue;
    }

    const typeProperty = getObjectProperty(property.value, "type");
    const requiredProperty = getObjectProperty(property.value, "required");
    const skipCheckProperty = getObjectProperty(property.value, "skipCheck");

    props[propName] = {
      types: typeProperty ? readRuntimeTypes(typeProperty.value) : null,
      required:
        requiredProperty && isBooleanLiteral(requiredProperty.value)
          ? requiredProperty.value.value
          : false,
      skipCheck:
        skipCheckProperty && isBooleanLiteral(skipCheckProperty.value)
          ? skipCheckProperty.value.value
          : false,
    };
  }

  return props;
}

export async function resolveDefinePropsCase(
  input: ResolveDefinePropsCaseInput,
): Promise<ResolveDefinePropsCaseResult> {
  const filename = "src/App.vue";
  const source = `<script setup lang="ts">\n${input.scriptSetup}\n</script>\n`;
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
  const globalTypeFiles = Object.keys(projectFiles)
    .filter((path) => path.endsWith(".d.ts") && !path.includes("node_modules"))
    .map((path) => join(project.root, path));
  let compiled = "";
  let runtimeProps: Record<string, RuntimePropInfo> = {};

  if (input.compile !== false) {
    const { descriptor } = parseSfc(transformed, { filename: id });
    compiled = compileScript(descriptor, {
      id: filename,
      fs: {
        fileExists: existsSync,
        readFile(file) {
          return readFileSync(file, "utf8");
        },
        realpath: realpathSync,
      },
      globalTypeFiles,
      inlineTemplate: false,
    }).content;
    runtimeProps = extractRuntimeProps(compiled);
  }

  return {
    root: project.root,
    source,
    transformed,
    compiled,
    warnings,
    runtimeProps,
  };
}
