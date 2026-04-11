import { dirname, join, resolve } from "node:path";

import MagicString from "magic-string";
import { parse } from "@babel/parser";
import type { Plugin, TransformResult } from "vite-plus";

import { materializeRootProps } from "./materialize/materializeRootProps";
import { printTypeLiteral } from "./materialize/printTypeLiteral";
import { normalizeOptions, type VueTypeResolverOptions } from "./options";
import { findDefinePropsCalls } from "./sfc/findDefinePropsCalls";
import { parseSfc, type ParsedSfc } from "./sfc/parseSfc";
import { TsgoSession } from "./tsgo/session";
import { buildAnalysisModule } from "./virtual/buildAnalysisModule";
import { formatFallbackWarning } from "./warnings";

interface AnalysisParts {
  imports: string[];
  localDeclarations: string[];
}

interface CachedTransformEntry {
  code: string;
  result: TransformResult | null;
  warnings: string[];
}

interface TopLevelNode {
  type: string;
  start: number | null | undefined;
  end: number | null | undefined;
  declaration?: TopLevelNode | null;
}

function isSupportedLocalDeclaration(node: TopLevelNode): boolean {
  return [
    "ClassDeclaration",
    "FunctionDeclaration",
    "TSDeclareFunction",
    "TSInterfaceDeclaration",
    "TSModuleDeclaration",
    "TSTypeAliasDeclaration",
    "TSEnumDeclaration",
    "VariableDeclaration",
  ].includes(node.type);
}

function shouldIncludeLocalDeclaration(text: string): boolean {
  return !text.includes("defineProps");
}

function resolveProjectFile(tsconfigPath?: string): string {
  return tsconfigPath ? resolve(tsconfigPath) : resolve(process.cwd(), "tsconfig.json");
}

function collectAnalysisParts(sfc: ParsedSfc): AnalysisParts {
  const imports: string[] = [];
  const localDeclarations: string[] = [];

  for (const block of [sfc.script, sfc.scriptSetup]) {
    if (!block || block.attrs.lang !== "ts") {
      continue;
    }

    const ast = parse(block.content, {
      sourceType: "module",
      plugins: ["typescript"],
    });

    for (const node of ast.program.body as TopLevelNode[]) {
      if (node.start == null || node.end == null) {
        continue;
      }

      const text = block.content.slice(node.start, node.end);

      if (node.type === "ImportDeclaration") {
        imports.push(text);
        continue;
      }

      if (isSupportedLocalDeclaration(node)) {
        if (shouldIncludeLocalDeclaration(text)) {
          localDeclarations.push(text);
        }
        continue;
      }

      if (
        node.type === "ExportNamedDeclaration" &&
        node.declaration &&
        isSupportedLocalDeclaration(node.declaration)
      ) {
        if (shouldIncludeLocalDeclaration(text)) {
          localDeclarations.push(text);
        }
      }
    }
  }

  return { imports, localDeclarations };
}

function formatAnalysisWarning(file: string, reason: string): string {
  return [
    `[vite-plugin-vue-type-resolver] Failed to analyze defineProps type in ${file}:`,
    reason,
    "Falling back to Vue's default type resolution.",
  ].join("\n");
}

function getAnalysisVirtualFileName(id: string): string {
  return join(dirname(id), "__vtr__.ts");
}

function hasTsLang(code: string): boolean {
  return code.includes('lang="ts"') || code.includes("lang='ts'") || code.includes("lang=ts");
}

function mayContainTypedDefineProps(code: string): boolean {
  return (
    code.includes("<script") &&
    code.includes("setup") &&
    hasTsLang(code) &&
    code.includes("defineProps") &&
    code.includes("<")
  );
}

export function vueTypeResolver(options: VueTypeResolverOptions = {}): Plugin {
  const normalized = normalizeOptions(options);
  let projectFile: string;
  let session: TsgoSession | undefined;
  let sessionRoot: string | undefined;
  const transformCache = new Map<string, CachedTransformEntry>();
  const pendingChangedFiles = new Set<string>();

  function getProjectFile(): string {
    if (!projectFile) {
      projectFile = resolveProjectFile(normalized.tsconfigPath);
    }

    return projectFile;
  }

  async function closeSession(): Promise<void> {
    if (!session) {
      return;
    }

    const activeSession = session;
    session = undefined;
    sessionRoot = undefined;
    if (normalized.logSnapshotStats) {
      console.info(
        "[vite-plugin-vue-type-resolver] tsgo snapshot stats",
        activeSession.getSnapshotStats(),
      );
    }
    await activeSession.close();
  }

  function clearTransformCache(): void {
    transformCache.clear();
  }

  function clearPendingChangedFiles(): void {
    pendingChangedFiles.clear();
  }

  function rememberChangedFile(path?: string): void {
    if (!path) {
      return;
    }

    const normalizedPath = resolve(path);
    if (normalizedPath.endsWith(".vue")) {
      return;
    }

    pendingChangedFiles.add(normalizedPath);
  }

  function invalidateTransformCache(path?: string): void {
    if (!path) {
      clearTransformCache();
      return;
    }

    if (path.endsWith(".vue")) {
      transformCache.delete(path);
      return;
    }

    clearTransformCache();
  }

  function getCachedTransform(id: string, code: string): CachedTransformEntry | undefined {
    const cached = transformCache.get(id);
    return cached && cached.code === code ? cached : undefined;
  }

  function setCachedTransform(
    id: string,
    code: string,
    result: CachedTransformEntry["result"],
    warnings: string[],
  ): CachedTransformEntry["result"] {
    transformCache.set(id, {
      code,
      result,
      warnings: [...warnings],
    });
    return result;
  }

  function replayWarnings(context: { warn(message: string): void }, warnings: string[]): void {
    for (const warning of warnings) {
      context.warn(warning);
    }
  }

  async function getSession(): Promise<TsgoSession> {
    const root = dirname(getProjectFile());

    if (session && sessionRoot === root) {
      return session;
    }

    await closeSession();

    session = new TsgoSession({ root });
    sessionRoot = root;
    return session;
  }

  return {
    name: "vite-plugin-vue-type-resolver",
    enforce: "pre",
    async buildStart() {
      clearTransformCache();
      clearPendingChangedFiles();
      projectFile = resolveProjectFile(normalized.tsconfigPath);
    },
    watchChange(id) {
      rememberChangedFile(id);
      invalidateTransformCache(id);
    },
    handleHotUpdate(context) {
      rememberChangedFile(context.file);
      invalidateTransformCache(context.file);
    },
    async buildEnd() {
      clearTransformCache();
      clearPendingChangedFiles();
      await closeSession();
    },
    async closeBundle() {
      clearTransformCache();
      clearPendingChangedFiles();
      await closeSession();
    },
    async transform(code, id, _options) {
      if (!id.endsWith(".vue")) return null;
      if (!mayContainTypedDefineProps(code)) return null;

      const cached = getCachedTransform(id, code);
      if (cached) {
        replayWarnings(this, cached.warnings);
        return cached.result;
      }

      const activeProjectFile = getProjectFile();
      const activeSession = await getSession();
      const warnings: string[] = [];
      const changedFiles = pendingChangedFiles.size > 0 ? [...pendingChangedFiles] : undefined;
      let attemptedAnalysis = false;

      const warn = (message: string) => {
        warnings.push(message);
        this.warn(message);
      };

      const sfc = parseSfc(id, code);
      const calls = findDefinePropsCalls(sfc);
      if (calls.length === 0) {
        return setCachedTransform(id, code, null, warnings);
      }

      const analysis = collectAnalysisParts(sfc);
      const magic = new MagicString(code);
      let changed = false;

      for (let index = 0; index < calls.length; index += 1) {
        const call = calls[index];
        attemptedAnalysis = true;
        const described = await activeSession.describeRootType({
          projectFile: activeProjectFile,
          virtualFileName: getAnalysisVirtualFileName(id),
          sourceText: buildAnalysisModule({
            imports: analysis.imports,
            localDeclarations: analysis.localDeclarations,
            targetTypeText: call.typeText,
            targetName: `__VTR_Target_${index}`,
          }),
          targetName: `__VTR_Target_${index}`,
          changedFiles,
        });

        if (!described.ok) {
          warn(formatAnalysisWarning(id, described.reason));
          continue;
        }

        const materialized = await materializeRootProps({
          type: described.type,
        });

        if (!materialized.ok) {
          warn(formatFallbackWarning(id, materialized.reason));
          continue;
        }

        magic.overwrite(call.typeArgStart, call.typeArgEnd, printTypeLiteral(materialized.props));
        changed = true;
      }

      if (!changed) {
        if (attemptedAnalysis) {
          clearPendingChangedFiles();
        }
        return setCachedTransform(id, code, null, warnings);
      }

      const result = setCachedTransform(
        id,
        code,
        {
          code: magic.toString(),
          map: magic.generateMap({ hires: true }) as TransformResult["map"],
        },
        warnings,
      );

      if (attemptedAnalysis) {
        clearPendingChangedFiles();
      }

      return result;
    },
  };
}
