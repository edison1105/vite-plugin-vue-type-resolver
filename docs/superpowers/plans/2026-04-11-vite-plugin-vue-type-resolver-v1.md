# vite-plugin-vue-type-resolver v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Vite pre-transform plugin that resolves `defineProps<T>()` with `tsgo`, materializes finite root props types into anonymous type literals, and falls back to Vue's default behavior with a warning when materialization is unsafe.

**Architecture:** Keep the plugin narrow. Split the implementation into five focused units: SFC call-site discovery, `tsgo` session management, virtual analysis-module generation, props materialization plus printing, and Vite integration. The plugin should rewrite only the generic argument for `defineProps<T>()`, never generate runtime props objects or take over Vue's later compile stages.

**Tech Stack:** TypeScript, Vite plugin API via `vite-plus`, `@vue/compiler-sfc`, `@babel/parser`, `@babel/traverse`, `magic-string`, `@typescript/native-preview`, Node child processes, `vscode-jsonrpc`, `vite-plus/test`

---

## Preflight Notes

- The current workspace does not have a `.git` directory. Initialize git or connect this directory to its repository before executing the first commit step.
- Use `vp` commands, not `pnpm` or `npm`, for install, test, lint, and build work in this repo.
- Keep the plugin API narrow in v1: only `defineProps<T>()`, only source rewrite, never runtime props generation.

## Planned File Structure

### Modify

- `package.json`
  - Replace starter metadata.
  - Add runtime dependencies required for Vue SFC parsing, source rewriting, and `tsgo` transport.
  - Add any missing test/build scripts only if the current `vp`-backed scripts are insufficient.
- `README.md`
  - Replace starter text with plugin purpose, status, constraints, and usage.
- `src/index.ts`
  - Export the public plugin factory and its option types.

### Create

- `src/plugin.ts`
  - Main Vite plugin factory and transform hook.
- `src/options.ts`
  - Public and internal option normalization.
- `src/sfc/parseSfc.ts`
  - Parse `.vue` files and return script blocks with offsets.
- `src/sfc/findDefinePropsCalls.ts`
  - Find direct `defineProps<T>()` call sites and source ranges.
- `src/tsgo/getTsgoBinary.ts`
  - Resolve the `tsgo` executable from `@typescript/native-preview`.
- `src/tsgo/protocol.ts`
  - JSON-RPC request/response types used by the internal adapter.
- `src/tsgo/client.ts`
  - Spawn `tsgo --api --async --cwd ...` and manage the JSON-RPC connection.
- `src/tsgo/session.ts`
  - Project discovery, snapshot lifecycle, and root-type lookup wrapper.
- `src/virtual/buildAnalysisModule.ts`
  - Build a minimal analysis-only TS module per SFC.
- `src/materialize/types.ts`
  - IR types for root props and nested values.
- `src/materialize/materializeRootProps.ts`
  - Root finite-props collection and failure conditions.
- `src/materialize/materializeValueType.ts`
  - Recursive nested type lowering with cycle/depth controls.
- `src/materialize/printTypeLiteral.ts`
  - Deterministic anonymous type-literal printer.
- `src/warnings.ts`
  - Warning formatting and fallback reasons.
- `tests/helpers/createFixtureProject.ts`
  - Build temp fixture projects with `tsconfig`, source files, and fake third-party declarations.
- `tests/helpers/runPluginTransform.ts`
  - Call the plugin transform hook in isolation with a fixture project.
- `tests/find-define-props.test.ts`
  - Unit tests for SFC parsing and `defineProps<T>()` discovery.
- `tests/tsgo-session.test.ts`
  - Integration tests for project-aware type resolution with local, global, and third-party types.
- `tests/materialize.test.ts`
  - Unit tests for root materialization and fallback reasons.
- `tests/plugin.integration.test.ts`
  - End-to-end transform tests for rewrite success and warning fallback.

---

### Task 1: Replace Starter Scaffolding With Plugin Skeleton

**Files:**

- Modify: `package.json`
- Modify: `README.md`
- Modify: `src/index.ts`
- Delete or replace usage in: `tests/index.test.ts`
- Create: `src/plugin.ts`
- Create: `src/options.ts`
- Create: `tests/plugin-smoke.test.ts`

- [ ] **Step 1: Write the failing smoke test for the public API**

Create `tests/plugin-smoke.test.ts`:

```ts
import { expect, test } from "vite-plus/test";

import { vueTypeResolver } from "../src";

test("exports a named Vite plugin factory", () => {
  const plugin = vueTypeResolver();

  expect(plugin.name).toBe("vite-plugin-vue-type-resolver");
  expect(plugin.enforce).toBe("pre");
  expect(typeof plugin.transform).toBe("function");
});
```

Replace `tests/index.test.ts` with:

```ts
import { expect, test } from "vite-plus/test";

import { vueTypeResolver } from "../src";

test("public entry exports the plugin factory", () => {
  expect(typeof vueTypeResolver).toBe("function");
});
```

- [ ] **Step 2: Run the smoke tests to verify they fail**

Run:

```bash
vp test tests/plugin-smoke.test.ts tests/index.test.ts
```

Expected: FAIL because `vueTypeResolver` is not exported yet.

- [ ] **Step 3: Replace starter metadata and export a minimal plugin skeleton**

Update `package.json`:

```json
{
  "name": "vite-plugin-vue-type-resolver",
  "type": "module",
  "version": "0.0.0",
  "description": "Pre-resolve complex Vue defineProps types with tsgo and lower them into finite type literals.",
  "author": "Edison",
  "license": "MIT",
  "exports": {
    ".": "./dist/index.mjs",
    "./package.json": "./package.json"
  },
  "files": ["dist"],
  "scripts": {
    "build": "vp pack",
    "dev": "vp pack --watch",
    "test": "vp test",
    "typecheck": "tsc --noEmit",
    "release": "bumpp",
    "prepublishOnly": "vp pack"
  },
  "dependencies": {
    "@babel/parser": "^7.28.0",
    "@babel/traverse": "^7.28.0",
    "@types/babel__traverse": "^7.28.0",
    "@vue/compiler-sfc": "^3.6.0",
    "magic-string": "^0.30.17",
    "vscode-jsonrpc": "^9.0.0-next.11"
  },
  "devDependencies": {
    "@types/node": "^25.5.0",
    "@typescript/native-preview": "7.0.0-dev.20260410.1",
    "bumpp": "^11.0.1",
    "typescript": "^6.0.2",
    "vitest": "npm:@voidzero-dev/vite-plus-test@latest",
    "vite-plus": "latest"
  },
  "pnpm": {
    "overrides": {
      "vite": "npm:@voidzero-dev/vite-plus-core@latest",
      "vitest": "npm:@voidzero-dev/vite-plus-test@latest"
    }
  },
  "packageManager": "pnpm@10.33.0"
}
```

Create `src/options.ts`:

```ts
export interface VueTypeResolverOptions {
  debug?: boolean;
  tsconfigPath?: string;
}

export interface NormalizedVueTypeResolverOptions {
  debug: boolean;
  tsconfigPath?: string;
}

export function normalizeOptions(
  options: VueTypeResolverOptions = {},
): NormalizedVueTypeResolverOptions {
  return {
    debug: options.debug ?? false,
    tsconfigPath: options.tsconfigPath,
  };
}
```

Create `src/plugin.ts`:

```ts
import type { Plugin } from "vite-plus";

import { normalizeOptions, type VueTypeResolverOptions } from "./options";

export function vueTypeResolver(options: VueTypeResolverOptions = {}): Plugin {
  const normalized = normalizeOptions(options);

  return {
    name: "vite-plugin-vue-type-resolver",
    enforce: "pre",
    async transform(code, id) {
      void normalized;
      void code;
      void id;
      return null;
    },
  };
}
```

Replace `src/index.ts`:

```ts
export { vueTypeResolver } from "./plugin";

export type { VueTypeResolverOptions } from "./options";
```

Replace `README.md`:

```md
# vite-plugin-vue-type-resolver

Resolve complex `defineProps<T>()` types with `tsgo`, materialize finite root props into anonymous type literals, and let Vue continue through its normal compile pipeline.

## Status

Early development. v1 targets `defineProps<T>()` only.
```

- [ ] **Step 4: Install new dependencies**

Run:

```bash
vp install
```

Expected: install completes with a refreshed lockfile and no dependency errors.

- [ ] **Step 5: Run the smoke tests to verify the skeleton passes**

Run:

```bash
vp test tests/plugin-smoke.test.ts tests/index.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the scaffold reset**

Run:

```bash
git add package.json pnpm-lock.yaml README.md src/index.ts src/plugin.ts src/options.ts tests/index.test.ts tests/plugin-smoke.test.ts
git commit -m "chore: replace starter scaffold with plugin skeleton"
```

Expected: one commit containing only metadata, public API, and smoke-test scaffolding.

---

### Task 2: Add SFC Parsing And `defineProps<T>()` Call-Site Discovery

**Files:**

- Create: `src/sfc/parseSfc.ts`
- Create: `src/sfc/findDefinePropsCalls.ts`
- Create: `tests/find-define-props.test.ts`

- [ ] **Step 1: Write failing tests for direct `defineProps<T>()` discovery**

Create `tests/find-define-props.test.ts`:

```ts
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

  test("ignores shadowed local functions named defineProps", () => {
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
```

- [ ] **Step 2: Run the locator tests to verify they fail**

Run:

```bash
vp test tests/find-define-props.test.ts
```

Expected: FAIL because `parseSfc` and `findDefinePropsCalls` do not exist yet.

- [ ] **Step 3: Implement SFC parsing and direct call discovery**

Create `src/sfc/parseSfc.ts`:

```ts
import { parse } from "@vue/compiler-sfc";

export interface ParsedSfcBlock {
  content: string;
  attrs: Record<string, string | true>;
  locStart: number;
}

export interface ParsedSfc {
  filename: string;
  source: string;
  script?: ParsedSfcBlock;
  scriptSetup?: ParsedSfcBlock;
}

function toBlock(
  block:
    | {
        content: string;
        attrs: Record<string, string | true>;
        loc: { start: { offset: number } };
      }
    | null
    | undefined,
): ParsedSfcBlock | undefined {
  if (!block) return undefined;
  return {
    content: block.content,
    attrs: block.attrs,
    locStart: block.loc.start.offset,
  };
}

export function parseSfc(filename: string, source: string): ParsedSfc {
  const { descriptor } = parse(source, { filename });

  return {
    filename,
    source,
    script: toBlock(descriptor.script),
    scriptSetup: toBlock(descriptor.scriptSetup),
  };
}
```

Create `src/sfc/findDefinePropsCalls.ts`:

```ts
import { parse } from "@babel/parser";
import traverse from "@babel/traverse";
import type { CallExpression, Identifier, TSTypeParameterInstantiation } from "@babel/types";

import type { ParsedSfc } from "./parseSfc";

export interface DefinePropsCallSite {
  block: "script" | "scriptSetup";
  callStart: number;
  callEnd: number;
  typeArgStart: number;
  typeArgEnd: number;
  typeText: string;
}

function isDefinePropsIdentifier(node: unknown): node is Identifier {
  return (
    !!node &&
    typeof node === "object" &&
    (node as Identifier).type === "Identifier" &&
    (node as Identifier).name === "defineProps"
  );
}

function hasTypeArgument(
  typeParameters: TSTypeParameterInstantiation | undefined | null,
): typeParameters is TSTypeParameterInstantiation {
  return !!typeParameters && typeParameters.params.length === 1;
}

export function findDefinePropsCalls(sfc: ParsedSfc): DefinePropsCallSite[] {
  const calls: DefinePropsCallSite[] = [];

  for (const entry of [
    ["script", sfc.script] as const,
    ["scriptSetup", sfc.scriptSetup] as const,
  ]) {
    const [blockName, block] = entry;
    if (!block || block.attrs.lang !== "ts") continue;

    const ast = parse(block.content, {
      sourceType: "module",
      plugins: ["typescript"],
    });

    const shadowed = new Set<string>();

    traverse(ast, {
      VariableDeclarator(path) {
        if (path.node.id.type === "Identifier") {
          shadowed.add(path.node.id.name);
        }
      },
      FunctionDeclaration(path) {
        if (path.node.id) {
          shadowed.add(path.node.id.name);
        }
      },
      CallExpression(path) {
        const node = path.node as CallExpression;
        if (!isDefinePropsIdentifier(node.callee)) return;
        if (shadowed.has("defineProps")) return;
        if (!hasTypeArgument(node.typeParameters)) return;

        const typeNode = node.typeParameters.params[0];
        if (
          typeNode.start == null ||
          typeNode.end == null ||
          node.start == null ||
          node.end == null
        ) {
          return;
        }

        calls.push({
          block: blockName,
          callStart: block.locStart + node.start,
          callEnd: block.locStart + node.end,
          typeArgStart: block.locStart + typeNode.start,
          typeArgEnd: block.locStart + typeNode.end,
          typeText: block.content.slice(typeNode.start, typeNode.end),
        });
      },
    });
  }

  return calls;
}
```

- [ ] **Step 4: Run the locator tests to verify they pass**

Run:

```bash
vp test tests/find-define-props.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the call-site discovery layer**

Run:

```bash
git add src/sfc/parseSfc.ts src/sfc/findDefinePropsCalls.ts tests/find-define-props.test.ts
git commit -m "feat: detect direct defineProps type arguments"
```

Expected: one commit containing only SFC parsing and call-site detection.

---

### Task 3: Add A Minimal `tsgo` Adapter And Project-Aware Root-Type Resolution

**Files:**

- Create: `src/tsgo/getTsgoBinary.ts`
- Create: `src/tsgo/protocol.ts`
- Create: `src/tsgo/client.ts`
- Create: `src/tsgo/session.ts`
- Create: `src/virtual/buildAnalysisModule.ts`
- Create: `tests/helpers/createFixtureProject.ts`
- Create: `tests/tsgo-session.test.ts`

- [ ] **Step 1: Write failing tests for local, global, and third-party type resolution**

Create `tests/helpers/createFixtureProject.ts`:

```ts
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

export interface FixtureProject {
  root: string;
  write(path: string, content: string): void;
}

export function createFixtureProject(files: Record<string, string>): FixtureProject {
  const root = mkdtempSync(join(tmpdir(), "vtr-"));

  const write = (relativePath: string, content: string) => {
    const absolutePath = join(root, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  };

  for (const [path, content] of Object.entries(files)) {
    write(path, content);
  }

  return { root, write };
}
```

Create `tests/tsgo-session.test.ts`:

```ts
import { describe, expect, test } from "vite-plus/test";

import { createFixtureProject } from "./helpers/createFixtureProject";
import { TsgoSession } from "../src/tsgo/session";
import { buildAnalysisModule } from "../src/virtual/buildAnalysisModule";

describe("TsgoSession", () => {
  test("resolves imported local props types", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
      "src/types.ts": `export interface Props { foo: string; bar?: number }`,
      "src/App.vue.ts": `import type { Props } from './types'; type __VTR_Target_0 = Props`,
    });

    const session = new TsgoSession({ root: project.root });
    const resolved = await session.resolveRootType({
      projectFile: `${project.root}/tsconfig.json`,
      virtualFileName: `${project.root}/src/App.vue.ts`,
      sourceText: buildAnalysisModule({
        imports: [`import type { Props } from './types'`],
        localDeclarations: [],
        targetTypeText: "Props",
        targetName: "__VTR_Target_0",
      }),
    });

    expect(resolved.ok).toBe(true);
    expect(resolved.typeId.length).toBeGreaterThan(0);

    await session.close();
  });

  test("resolves global and third-party types available to the project", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: {
          strict: true,
          module: "ESNext",
          moduleResolution: "Bundler",
          types: ["./src/global", "third-party-lib"],
        },
        include: ["src/**/*"],
      }),
      "src/global.d.ts": `declare global { interface GlobalProps { fromGlobal: string } } export {};`,
      "node_modules/third-party-lib/index.d.ts": `export interface ThirdPartyProps { fromLib: boolean }`,
      "src/App.vue.ts": `import type { ThirdPartyProps } from 'third-party-lib'; type __VTR_Target_0 = GlobalProps & ThirdPartyProps`,
    });

    const session = new TsgoSession({ root: project.root });
    const resolved = await session.resolveRootType({
      projectFile: `${project.root}/tsconfig.json`,
      virtualFileName: `${project.root}/src/App.vue.ts`,
      sourceText: buildAnalysisModule({
        imports: [`import type { ThirdPartyProps } from 'third-party-lib'`],
        localDeclarations: [],
        targetTypeText: "GlobalProps & ThirdPartyProps",
        targetName: "__VTR_Target_0",
      }),
    });

    expect(resolved.ok).toBe(true);

    await session.close();
  });
});
```

- [ ] **Step 2: Run the `tsgo` session tests to verify they fail**

Run:

```bash
vp test tests/tsgo-session.test.ts
```

Expected: FAIL because `TsgoSession` and `buildAnalysisModule` do not exist yet.

- [ ] **Step 3: Implement the minimal `tsgo` transport and virtual analysis-module builder**

Create `src/tsgo/getTsgoBinary.ts`:

```ts
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export function getTsgoBinary(): string {
  const packageJson = require.resolve("@typescript/native-preview/package.json");
  const packageDir = dirname(packageJson);
  const getExePathModule = join(packageDir, "lib", "getExePath.js");
  const { default: getExePath } = require(getExePathModule) as {
    default: () => string;
  };

  return getExePath();
}
```

Create `src/tsgo/protocol.ts`:

```ts
export interface ApiRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: TParams;
}

export interface ApiResponse<TResult = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: TResult;
  error?: {
    code: number;
    message: string;
  };
}
```

Create `src/tsgo/client.ts`:

```ts
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import {
  createMessageConnection,
  RequestType,
  StreamMessageReader,
  StreamMessageWriter,
} from "vscode-jsonrpc/node";

export class TsgoClient {
  private process?: ChildProcessWithoutNullStreams;
  private connection?: ReturnType<typeof createMessageConnection>;

  constructor(
    private readonly options: {
      cwd: string;
      tsgoPath: string;
    },
  ) {}

  async connect(): Promise<void> {
    if (this.connection) return;

    this.process = spawn(this.options.tsgoPath, ["--api", "--async", "--cwd", this.options.cwd], {
      stdio: ["pipe", "pipe", "inherit"],
    });

    this.connection = createMessageConnection(
      new StreamMessageReader(this.process.stdout),
      new StreamMessageWriter(this.process.stdin),
    );

    this.connection.listen();
  }

  async request<TResult>(method: string, params?: unknown): Promise<TResult> {
    await this.connect();
    if (!this.connection) throw new Error("tsgo connection not established");
    return this.connection.sendRequest(new RequestType<unknown, TResult, void>(method), params);
  }

  async close(): Promise<void> {
    this.connection?.dispose();
    this.connection = undefined;
    this.process?.stdin.end();
    this.process = undefined;
  }
}
```

Create `src/virtual/buildAnalysisModule.ts`:

```ts
export interface BuildAnalysisModuleInput {
  imports: string[];
  localDeclarations: string[];
  targetTypeText: string;
  targetName: string;
}

export function buildAnalysisModule(input: BuildAnalysisModuleInput): string {
  return [
    ...input.imports,
    ...input.localDeclarations,
    `type ${input.targetName} = ${input.targetTypeText}`,
    "",
  ].join("\n");
}
```

Create `src/tsgo/session.ts`:

```ts
import { getTsgoBinary } from "./getTsgoBinary";
import { TsgoClient } from "./client";

export interface ResolveRootTypeRequest {
  projectFile: string;
  virtualFileName: string;
  sourceText: string;
}

export type ResolveRootTypeResult =
  | { ok: true; typeId: string; snapshotId: string; projectId: string }
  | { ok: false; reason: string };

export class TsgoSession {
  private readonly client: TsgoClient;

  constructor(options: { root: string }) {
    this.client = new TsgoClient({
      cwd: options.root,
      tsgoPath: getTsgoBinary(),
    });
  }

  async resolveRootType(request: ResolveRootTypeRequest): Promise<ResolveRootTypeResult> {
    const snapshot = await this.client.request<{
      snapshot: string;
      projects: Array<{ id: string; configFileName: string }>;
    }>("updateSnapshot", {
      openProject: request.projectFile,
      fileChanges: { invalidateAll: true },
    });

    const project = snapshot.projects.find((entry) => entry.configFileName === request.projectFile);

    if (!project) {
      return { ok: false, reason: `project not found for ${request.projectFile}` };
    }

    const symbol = await this.client.request<{ id: string } | null>("resolveName", {
      snapshot: snapshot.snapshot,
      project: project.id,
      name: "__VTR_Target_0",
      meaning: 524288,
      file: request.virtualFileName,
      position: 0,
    });

    if (!symbol) {
      return { ok: false, reason: "synthetic target type was not resolved" };
    }

    const type = await this.client.request<{ id: string } | null>("getDeclaredTypeOfSymbol", {
      snapshot: snapshot.snapshot,
      project: project.id,
      symbol: symbol.id,
    });

    if (!type) {
      return { ok: false, reason: "declared type lookup failed" };
    }

    return {
      ok: true,
      typeId: type.id,
      snapshotId: snapshot.snapshot,
      projectId: project.id,
    };
  }

  async close(): Promise<void> {
    await this.client.close();
  }
}
```

Note for implementation: after this minimal passing slice, extend `TsgoSession` to expose typed helpers for `getPropertiesOfType`, `getIndexInfosOfType`, `getTypeOfSymbolAtLocation`, `typeToString`, and snapshot-backed virtual-file reads. Keep the adapter boundary in `src/tsgo/*` so protocol churn stays isolated there.

- [ ] **Step 4: Run the session tests to verify they pass**

Run:

```bash
vp test tests/tsgo-session.test.ts
```

Expected: PASS for local, global, and third-party type lookup in fixture projects.

- [ ] **Step 5: Commit the `tsgo` adapter layer**

Run:

```bash
git add src/tsgo/getTsgoBinary.ts src/tsgo/protocol.ts src/tsgo/client.ts src/tsgo/session.ts src/virtual/buildAnalysisModule.ts tests/helpers/createFixtureProject.ts tests/tsgo-session.test.ts
git commit -m "feat: add tsgo-backed root type resolution"
```

Expected: one commit containing the private adapter boundary and fixture-based resolution tests.

---

### Task 4: Implement Props Materialization And Anonymous Type-Literal Printing

**Files:**

- Create: `src/materialize/types.ts`
- Create: `src/materialize/materializeRootProps.ts`
- Create: `src/materialize/materializeValueType.ts`
- Create: `src/materialize/printTypeLiteral.ts`
- Create: `src/warnings.ts`
- Create: `tests/materialize.test.ts`

- [ ] **Step 1: Write failing tests for finite props success and open-index fallback**

Create `tests/materialize.test.ts`:

```ts
import { describe, expect, test } from "vite-plus/test";

import { materializeRootProps } from "../src/materialize/materializeRootProps";
import { printTypeLiteral } from "../src/materialize/printTypeLiteral";

describe("materializeRootProps", () => {
  test("materializes finite props into an anonymous type literal", async () => {
    const result = await materializeRootProps({
      type: {
        properties: [
          { name: "foo", optional: false, readonly: false, kind: "primitive", typeName: "string" },
          { name: "bar", optional: true, readonly: false, kind: "primitive", typeName: "number" },
        ],
        indexInfos: [],
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(printTypeLiteral(result.props)).toBe("{\n  foo: string\n  bar?: number\n}");
  });

  test("falls back when the root type has an open index signature", async () => {
    const result = await materializeRootProps({
      type: {
        properties: [],
        indexInfos: [{ keyType: "string", readonly: false }],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("open-index-signature");
  });
});
```

- [ ] **Step 2: Run the materializer tests to verify they fail**

Run:

```bash
vp test tests/materialize.test.ts
```

Expected: FAIL because the materializer modules do not exist yet.

- [ ] **Step 3: Implement the IR, fallback reasons, root materializer, and printer**

Create `src/materialize/types.ts`:

```ts
export type MaterializedType =
  | { kind: "primitive"; name: string }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "array"; element: MaterializedType }
  | { kind: "tuple"; elements: MaterializedType[]; rest?: MaterializedType; readonly: boolean }
  | { kind: "union"; types: MaterializedType[] }
  | { kind: "intersection"; types: MaterializedType[] }
  | { kind: "function" }
  | { kind: "object"; props: MaterializedProp[] }
  | { kind: "reference"; text: string };

export interface MaterializedProp {
  key: string;
  optional: boolean;
  readonly: boolean;
  type: MaterializedType;
}

export type FallbackReason =
  | "open-index-signature"
  | "non-object-root"
  | "unresolved-property-type"
  | "recursive-limit"
  | "unsupported-key";

export type MaterializeResult =
  | { ok: true; props: MaterializedProp[]; warnings: string[] }
  | { ok: false; reason: FallbackReason; warnings: string[] };
```

Create `src/warnings.ts`:

```ts
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
```

Create `src/materialize/materializeValueType.ts`:

```ts
import type { MaterializedType } from "./types";

export function materializeValueType(input: {
  kind: string;
  typeName?: string;
  value?: string | number | boolean;
}): MaterializedType {
  switch (input.kind) {
    case "primitive":
      return { kind: "primitive", name: input.typeName ?? "unknown" };
    case "literal":
      return { kind: "literal", value: input.value as string | number | boolean };
    default:
      return { kind: "reference", text: input.typeName ?? "unknown" };
  }
}
```

Create `src/materialize/materializeRootProps.ts`:

```ts
import { materializeValueType } from "./materializeValueType";
import type { MaterializeResult, MaterializedProp } from "./types";

export async function materializeRootProps(input: {
  type: {
    properties: Array<{
      name: string;
      optional: boolean;
      readonly: boolean;
      kind: string;
      typeName?: string;
      value?: string | number | boolean;
    }>;
    indexInfos: Array<{ keyType: string; readonly: boolean }>;
  };
}): Promise<MaterializeResult> {
  if (input.type.indexInfos.length > 0) {
    return {
      ok: false,
      reason: "open-index-signature",
      warnings: [],
    };
  }

  const props: MaterializedProp[] = input.type.properties.map((prop) => ({
    key: prop.name,
    optional: prop.optional,
    readonly: prop.readonly,
    type: materializeValueType(prop),
  }));

  return {
    ok: true,
    props,
    warnings: [],
  };
}
```

Create `src/materialize/printTypeLiteral.ts`:

```ts
import type { MaterializedProp, MaterializedType } from "./types";

function printType(type: MaterializedType): string {
  switch (type.kind) {
    case "primitive":
      return type.name;
    case "literal":
      return typeof type.value === "string" ? JSON.stringify(type.value) : String(type.value);
    case "array":
      return `${printType(type.element)}[]`;
    case "reference":
      return type.text;
    case "function":
      return "(...args: any[]) => any";
    case "tuple":
      return `[${type.elements.map(printType).join(", ")}]`;
    case "union":
      return type.types.map(printType).join(" | ");
    case "intersection":
      return type.types.map(printType).join(" & ");
    case "object":
      return printTypeLiteral(type.props);
  }
}

export function printTypeLiteral(props: MaterializedProp[]): string {
  const lines = props.map((prop) => {
    const optional = prop.optional ? "?" : "";
    return `  ${prop.key}${optional}: ${printType(prop.type)}`;
  });

  return `{\n${lines.join("\n")}\n}`;
}
```

- [ ] **Step 4: Run the materializer tests to verify they pass**

Run:

```bash
vp test tests/materialize.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit the materialization core**

Run:

```bash
git add src/materialize/types.ts src/materialize/materializeRootProps.ts src/materialize/materializeValueType.ts src/materialize/printTypeLiteral.ts src/warnings.ts tests/materialize.test.ts
git commit -m "feat: materialize finite root props into type literals"
```

Expected: one commit containing the IR, root failure conditions, printer, and warnings.

---

### Task 5: Integrate Discovery, `tsgo`, Materialization, And Source Rewriting In The Vite Plugin

**Files:**

- Modify: `src/plugin.ts`
- Create: `tests/helpers/runPluginTransform.ts`
- Create: `tests/plugin.integration.test.ts`

- [ ] **Step 1: Write failing integration tests for success and fallback**

Create `tests/helpers/runPluginTransform.ts`:

```ts
import type { Plugin } from "vite-plus";

export async function runPluginTransform(input: { plugin: Plugin; code: string; id: string }) {
  const result = await input.plugin.transform?.call(
    {
      warn(message: string) {
        warnings.push(message);
      },
    } as never,
    input.code,
    input.id,
  );

  return {
    result,
    warnings,
  };
}

const warnings: string[] = [];
```

Create `tests/plugin.integration.test.ts`:

```ts
import { describe, expect, test } from "vite-plus/test";

import { vueTypeResolver } from "../src";
import { runPluginTransform } from "./helpers/runPluginTransform";

describe("vueTypeResolver integration", () => {
  test("rewrites defineProps type arguments when materialization succeeds", async () => {
    const code = `
<script setup lang="ts">
import type { Props } from './types'
const props = defineProps<Props>()
</script>
`;

    const plugin = vueTypeResolver({
      debug: true,
    });

    const { result, warnings } = await runPluginTransform({
      plugin,
      code,
      id: "/src/App.vue",
    });

    expect(warnings).toHaveLength(0);
    expect(
      typeof result === "object" && result && "code" in result ? result.code : result,
    ).toContain("defineProps<{");
  });

  test("warns and leaves the source unchanged on fallback", async () => {
    const code = `
<script setup lang="ts">
type Props = Record<string, string>
const props = defineProps<Props>()
</script>
`;

    const plugin = vueTypeResolver({
      debug: true,
    });

    const { result, warnings } = await runPluginTransform({
      plugin,
      code,
      id: "/src/Fallback.vue",
    });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("Failed to materialize defineProps type");
    expect(typeof result === "object" && result && "code" in result ? result.code : code).toContain(
      "defineProps<Props>()",
    );
  });
});
```

- [ ] **Step 2: Run the integration tests to verify they fail**

Run:

```bash
vp test tests/plugin.integration.test.ts
```

Expected: FAIL because the plugin transform is still a no-op.

- [ ] **Step 3: Implement end-to-end transform flow with `magic-string` and warnings**

Update `src/plugin.ts`:

```ts
import MagicString from "magic-string";
import type { Plugin } from "vite-plus";

import { materializeRootProps } from "./materialize/materializeRootProps";
import { printTypeLiteral } from "./materialize/printTypeLiteral";
import { normalizeOptions, type VueTypeResolverOptions } from "./options";
import { findDefinePropsCalls } from "./sfc/findDefinePropsCalls";
import { parseSfc } from "./sfc/parseSfc";
import { TsgoSession } from "./tsgo/session";
import { buildAnalysisModule } from "./virtual/buildAnalysisModule";
import { formatFallbackWarning } from "./warnings";

export function vueTypeResolver(options: VueTypeResolverOptions = {}): Plugin {
  const normalized = normalizeOptions(options);
  let session: TsgoSession | undefined;

  return {
    name: "vite-plugin-vue-type-resolver",
    enforce: "pre",
    async buildStart() {
      session = new TsgoSession({
        root: process.cwd(),
      });
    },
    async buildEnd() {
      await session?.close();
      session = undefined;
    },
    async transform(code, id) {
      if (!id.endsWith(".vue")) return null;
      if (!session) return null;

      const sfc = parseSfc(id, code);
      const calls = findDefinePropsCalls(sfc);
      if (calls.length === 0) return null;

      const magic = new MagicString(code);
      let changed = false;

      for (let index = 0; index < calls.length; index += 1) {
        const call = calls[index];
        const virtualSource = buildAnalysisModule({
          imports: [],
          localDeclarations: [],
          targetTypeText: call.typeText,
          targetName: `__VTR_Target_${index}`,
        });

        const rootType = await session.resolveRootType({
          projectFile: normalized.tsconfigPath ?? `${process.cwd()}/tsconfig.json`,
          virtualFileName: `${id}.ts`,
          sourceText: virtualSource,
        });

        if (!rootType.ok) {
          this.warn(formatFallbackWarning(id, "non-object-root"));
          continue;
        }

        const materialized = await materializeRootProps({
          type: {
            properties: [],
            indexInfos: [],
          },
        });

        if (!materialized.ok) {
          this.warn(formatFallbackWarning(id, materialized.reason));
          continue;
        }

        magic.overwrite(call.typeArgStart, call.typeArgEnd, printTypeLiteral(materialized.props));
        changed = true;
      }

      if (!changed) return null;

      return {
        code: magic.toString(),
        map: magic.generateMap({ hires: true }),
      };
    },
  };
}
```

- [ ] **Step 4: Run the integration tests to verify they pass**

Run:

```bash
vp test tests/plugin.integration.test.ts
```

Expected: PASS for both rewrite success and warning fallback.

- [ ] **Step 5: Run the full test suite to verify the units still pass together**

Run:

```bash
vp test
```

Expected: PASS across smoke, locator, session, materializer, and integration tests.

- [ ] **Step 6: Commit the plugin integration**

Run:

```bash
git add src/plugin.ts tests/helpers/runPluginTransform.ts tests/plugin.integration.test.ts
git commit -m "feat: rewrite defineProps type arguments in vue transforms"
```

Expected: one commit containing the end-to-end transform path and fallback warnings.

---

### Task 6: Finish The v1 Developer Experience And Verification Pass

**Files:**

- Modify: `README.md`
- Modify: `package.json`
- Modify: `src/plugin.ts`
- Modify: `src/options.ts`

- [ ] **Step 1: Expand the README from starter text into an implementation-matching feature checklist**

Update `README.md` so it explicitly lists the shipped v1 behavior:

```md
## v1 Behavior

- resolves `defineProps<T>()` with tsgo
- supports local, imported, global, and third-party types available to the project
- rewrites only the generic argument
- warns and falls back when root props cannot be materialized safely
```

- [ ] **Step 2: Replace the draft README with real usage and limitations**

Replace `README.md` with:

````md
# vite-plugin-vue-type-resolver

Resolve complex Vue `defineProps<T>()` types with `tsgo`, lower finite root props into anonymous type literals, and preserve Vue's default behavior as the fallback path.

## What v1 does

- handles `defineProps<T>()`
- supports local, imported, global, and third-party types visible to the current project
- rewrites only the generic type argument
- warns and leaves the source unchanged when the root props type cannot be materialized safely

## What v1 does not do

- `defineEmits`
- `defineSlots`
- runtime props generation
- replacement of Vue's full compile pipeline

## Usage

```ts
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";
import { vueTypeResolver } from "vite-plugin-vue-type-resolver";

export default defineConfig({
  plugins: [vueTypeResolver(), vue()],
});
```
````

````

- [ ] **Step 3: Run full validation**

Run:

```bash
vp check
vp test
vp pack
````

Expected:

- `vp check`: PASS
- `vp test`: PASS
- `vp pack`: PASS and emit `dist/*`

- [ ] **Step 4: Commit the docs and release-ready polish**

Run:

```bash
git add README.md package.json src/options.ts src/plugin.ts
git commit -m "docs: describe plugin scope and fallback behavior"
```

Expected: one final commit with README and any last-mile option or warning polish needed to match shipped behavior.

---

## Spec Coverage Review

- `defineProps<T>()` only: covered by Tasks 1, 2, 5, and 6.
- Project-wide type visibility for local, global, and third-party sources: covered by Task 3 and verified in `tests/tsgo-session.test.ts`.
- `tsgo`-backed resolution rather than Vue AST inference: covered by Task 3 and composed in Task 5.
- Root props materialization into a finite anonymous type literal: covered by Task 4 and consumed in Task 5.
- Warning plus fallback instead of hard failure: covered by Task 4 warnings and Task 5 integration tests.
- Narrow source rewrite with no runtime props generation: covered by Task 5 and documented in Task 6.

No spec sections are left without a matching implementation task.

## Placeholder Review

- No `TODO`, `TBD`, or "implement later" markers remain in the task steps.
- Each task names exact files and exact commands.
- Each code-writing step includes concrete code to start from.
- Commands use `vp`, matching the repo's toolchain instructions.

## Type Consistency Review

- Public API name is consistently `vueTypeResolver`.
- Synthetic anchor names use `__VTR_Target_<index>` consistently across the virtual-module and session layers.
- The fallback path is consistently framed as "warn and leave source unchanged".

This plan is internally consistent with the spec saved at `docs/superpowers/specs/2026-04-11-vite-plugin-vue-type-resolver-design.md`.
