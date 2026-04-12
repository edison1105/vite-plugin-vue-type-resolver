import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, isAbsolute, normalize, relative, resolve, sep } from "node:path";

import {
  extractEventNamesFromAnalysisSource,
  extractFiniteStringLiteralsFromTypeText,
} from "../emits/extractEventNames";
import { TsgoClient } from "./client";
import { getTsgoBinary } from "./getTsgoBinary";
import type {
  AccessibleEntriesResponse,
  DiagnosticResponse,
  TsgoIndexInfoResponse,
  TsgoSignatureResponse,
  TsgoSymbolResponse,
  TsgoTypeResponse,
  UpdateSnapshotResponse,
} from "./protocol";

export interface ResolveRootTypeRequest {
  projectFile: string;
  virtualFileName: string;
  sourceText: string;
  targetName: string;
  changedFiles?: string[];
}

export type ResolveRootTypeResult =
  | { ok: true; typeId: string; snapshotId: string; projectId: string }
  | { ok: false; reason: string };

export interface DescribeRootTypeRequest extends ResolveRootTypeRequest {}

export interface DescribeEmitNamesRequest extends ResolveRootTypeRequest {}

export interface SnapshotStats {
  currentMode: "incremental" | "full";
  incrementalAttempts: number;
  incrementalSuccesses: number;
  fullRebuilds: number;
  fallbacks: {
    sourceFileNotFound: number;
    syntheticTargetTypeNotResolved: number;
  };
}

export interface RootTypePropertyDescription {
  name: string;
  optional: boolean;
  readonly: boolean;
  unsupportedKey?: boolean;
  kind: string;
  typeName?: string;
  value?: string | number | boolean;
  properties?: RootTypePropertyDescription[];
}

export interface RootTypeIndexInfoDescription {
  keyType: string;
  readonly: boolean;
}

export type DescribeRootTypeResult =
  | {
      ok: true;
      type: {
        properties: RootTypePropertyDescription[];
        indexInfos: RootTypeIndexInfoDescription[];
      };
    }
  | { ok: false; reason: string };

export type DescribeEmitNamesResult =
  | {
      ok: true;
      eventNames: string[];
    }
  | { ok: false; reason: string };

const TYPE_ALIAS_MEANING = 524288;
const TYPE_FORMAT_NO_TRUNCATION = 1;
const OPTIONAL_FLAG = 16777216;
const READONLY_FLAG = 33554432;
const OBJECT_FLAG_CLASS = 1;
const OBJECT_FLAG_INTERFACE = 2;
const OBJECT_FLAG_REFERENCE = 4;
const OBJECT_FLAG_ANONYMOUS = 16;
const OVERLAY_SLOT_COUNT = 2;
const MAX_INLINE_OBJECT_DEPTH = 2;
const PRIMITIVE_TYPE_NAMES = new Set([
  "any",
  "bigint",
  "boolean",
  "never",
  "null",
  "number",
  "object",
  "string",
  "symbol",
  "undefined",
  "unknown",
  "void",
]);
const KNOWN_RUNTIME_OBJECT_REFERENCES = new Set([
  "AggregateError",
  "ArrayBuffer",
  "Blob",
  "DataView",
  "Date",
  "Error",
  "EvalError",
  "File",
  "FormData",
  "Headers",
  "Map",
  "Promise",
  "RangeError",
  "ReferenceError",
  "RegExp",
  "Request",
  "Response",
  "Set",
  "SharedArrayBuffer",
  "SyntaxError",
  "TypeError",
  "URIError",
  "URL",
  "URLSearchParams",
  "WeakMap",
  "WeakSet",
]);

interface ResolvedRootTypeContext {
  ok: true;
  typeId: string;
  snapshotId: string;
  projectId: string;
}

interface SnapshotFileChanges {
  changedFiles?: string[];
  invalidateAll?: boolean;
}

export class TsgoSession {
  private client: TsgoClient;
  private readonly root: string;
  private readonly virtualFiles = new Map<string, string>();
  private readonly overlayDirectories = new Map<
    string,
    {
      currentSlot: number;
      slotPaths: string[];
    }
  >();
  private snapshotMode: "incremental" | "full" = "incremental";
  private readonly snapshotStats: Omit<SnapshotStats, "currentMode"> = {
    incrementalAttempts: 0,
    incrementalSuccesses: 0,
    fullRebuilds: 0,
    fallbacks: {
      sourceFileNotFound: 0,
      syntheticTargetTypeNotResolved: 0,
    },
  };
  private resolutionQueue = Promise.resolve();
  private closed = false;

  constructor(options: { root: string }) {
    this.root = options.root;
    this.client = this.createClient();
  }

  private createClient(): TsgoClient {
    return new TsgoClient({
      cwd: this.root,
      tsgoPath: getTsgoBinary(),
      callbacks: {
        readFile: (path) => this.readVirtualFile(path),
        fileExists: (path) => this.virtualFileExists(path),
        directoryExists: (path) => this.virtualDirectoryExists(path),
        getAccessibleEntries: (path) => this.getAccessibleEntries(path),
        realpath: (path) => this.getVirtualRealpath(path),
      },
    });
  }

  private async resetClient(): Promise<void> {
    await this.client.close();
    this.client = this.createClient();
  }

  async resolveRootType(request: ResolveRootTypeRequest): Promise<ResolveRootTypeResult> {
    return this.enqueueResolution(() => this.resolveRootTypeInternal(request));
  }

  async describeRootType(request: DescribeRootTypeRequest): Promise<DescribeRootTypeResult> {
    return this.enqueueResolution(() => this.describeRootTypeInternal(request));
  }

  async describeEmitNames(request: DescribeEmitNamesRequest): Promise<DescribeEmitNamesResult> {
    return this.enqueueResolution(() => this.describeEmitNamesInternal(request));
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.resolutionQueue;
    await this.client.close();
  }

  getSnapshotStats(): SnapshotStats {
    return {
      currentMode: this.snapshotMode,
      incrementalAttempts: this.snapshotStats.incrementalAttempts,
      incrementalSuccesses: this.snapshotStats.incrementalSuccesses,
      fullRebuilds: this.snapshotStats.fullRebuilds,
      fallbacks: {
        sourceFileNotFound: this.snapshotStats.fallbacks.sourceFileNotFound,
        syntheticTargetTypeNotResolved: this.snapshotStats.fallbacks.syntheticTargetTypeNotResolved,
      },
    };
  }

  private async resolveRootTypeInternal(
    request: ResolveRootTypeRequest,
  ): Promise<ResolveRootTypeResult> {
    if (this.closed) {
      throw new Error("TsgoSession is closed");
    }

    const sourceText = this.buildVirtualSourceText(request);
    const virtualFileName = this.prepareVirtualFile(
      request.virtualFileName,
      sourceText,
      request.changedFiles,
    );
    this.virtualFiles.set(virtualFileName, sourceText);

    try {
      const resolved = await this.resolveRootTypeContext(request, virtualFileName);
      if (!resolved.ok) {
        return resolved;
      }

      return {
        ok: true,
        typeId: resolved.typeId,
        snapshotId: resolved.snapshotId,
        projectId: resolved.projectId,
      };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async describeRootTypeInternal(
    request: DescribeRootTypeRequest,
  ): Promise<DescribeRootTypeResult> {
    if (this.closed) {
      throw new Error("TsgoSession is closed");
    }

    const sourceText = this.buildVirtualSourceText(request);
    const virtualFileName = this.prepareVirtualFile(
      request.virtualFileName,
      sourceText,
      request.changedFiles,
    );
    this.virtualFiles.set(virtualFileName, sourceText);

    try {
      const resolved = await this.resolveRootTypeContext(request, virtualFileName);
      if (!resolved.ok) {
        return resolved;
      }

      const properties = await this.describeProperties(resolved, resolved.typeId, 0, new Set());
      const indexInfos = await this.describeIndexInfos(resolved);

      return {
        ok: true,
        type: {
          properties,
          indexInfos,
        },
      };
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async describeEmitNamesInternal(
    request: DescribeEmitNamesRequest,
  ): Promise<DescribeEmitNamesResult> {
    if (this.closed) {
      throw new Error("TsgoSession is closed");
    }

    const sourceText = this.buildVirtualSourceText(request);
    const virtualFileName = this.prepareVirtualFile(
      request.virtualFileName,
      sourceText,
      request.changedFiles,
    );
    this.virtualFiles.set(virtualFileName, sourceText);

    try {
      const resolved = await this.resolveRootTypeContext(request, virtualFileName);
      if (!resolved.ok) {
        return resolved;
      }

      const syntaxFallback = (): DescribeEmitNamesResult =>
        extractEventNamesFromAnalysisSource(request.sourceText, request.targetName);

      const properties = await this.client.request<TsgoSymbolResponse[]>("getPropertiesOfType", {
        snapshot: resolved.snapshotId,
        project: resolved.projectId,
        type: resolved.typeId,
      });

      const signatures = await this.client.request<TsgoSignatureResponse[]>("getSignaturesOfType", {
        snapshot: resolved.snapshotId,
        project: resolved.projectId,
        type: resolved.typeId,
        kind: 0,
      });

      if (properties.length > 0 && signatures.length > 0) {
        const fallback = syntaxFallback();
        return fallback.ok
          ? fallback
          : {
              ok: false,
              reason: "defineEmits() type cannot mix call signature and property syntax",
            };
      }

      if (signatures.length > 0) {
        const eventNames = new Set<string>();

        for (const signature of signatures) {
          const firstParameterId = signature.parameters[0];

          if (!firstParameterId) {
            const fallback = syntaxFallback();
            return fallback.ok
              ? fallback
              : { ok: false, reason: "event names are not a finite string literal union" };
          }

          const firstParameterType = await this.client.request<TsgoTypeResponse | null>(
            "getTypeOfSymbol",
            {
              snapshot: resolved.snapshotId,
              project: resolved.projectId,
              symbol: firstParameterId,
            },
          );

          if (!firstParameterType) {
            const fallback = syntaxFallback();
            return fallback.ok
              ? fallback
              : { ok: false, reason: "event names are not a finite string literal union" };
          }

          const firstParameterText = await this.client.request<string>("typeToString", {
            snapshot: resolved.snapshotId,
            project: resolved.projectId,
            type: firstParameterType.id,
            flags: TYPE_FORMAT_NO_TRUNCATION,
          });

          const extracted = extractFiniteStringLiteralsFromTypeText(firstParameterText);
          if (!extracted.ok) {
            const fallback = syntaxFallback();
            return fallback.ok ? fallback : extracted;
          }

          for (const eventName of extracted.eventNames) {
            eventNames.add(eventName);
          }
        }

        return {
          ok: true,
          eventNames: [...eventNames].sort(),
        };
      }

      if (properties.length > 0) {
        const eventNames = new Set<string>();

        for (const property of properties) {
          if (this.isUnsupportedPropertyKey(property)) {
            const fallback = syntaxFallback();
            return fallback.ok
              ? fallback
              : { ok: false, reason: "event names are not a finite string literal union" };
          }

          eventNames.add(property.name);
        }

        return {
          ok: true,
          eventNames: [...eventNames].sort(),
        };
      }

      return syntaxFallback();
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private prepareVirtualFile(
    requestVirtualFileName: string,
    sourceText: string,
    changedFiles?: string[],
  ): string {
    const requestedPath = this.normalizePath(requestVirtualFileName);
    const directoryPath = dirname(requestedPath);
    let entry = this.overlayDirectories.get(directoryPath);

    if (!entry) {
      const slotPaths = Array.from({ length: OVERLAY_SLOT_COUNT }, (_, index) =>
        join(directoryPath, `__vtr__${index}.ts`),
      );
      for (const slotPath of slotPaths) {
        if (!this.virtualFiles.has(slotPath)) {
          this.virtualFiles.set(slotPath, "");
        }
      }
      entry = {
        currentSlot: 0,
        slotPaths,
      };
      this.overlayDirectories.set(directoryPath, entry);
    }

    if (changedFiles && changedFiles.length > 0) {
      entry.currentSlot = (entry.currentSlot + 1) % entry.slotPaths.length;
    }

    const overlayPath = entry.slotPaths[entry.currentSlot];
    this.virtualFiles.set(overlayPath, sourceText);
    return overlayPath;
  }

  private buildVirtualSourceText(request: ResolveRootTypeRequest): string {
    if (!request.changedFiles || request.changedFiles.length === 0) {
      return request.sourceText;
    }

    const normalizedChangedFiles = request.changedFiles
      .map((file) => this.normalizePath(file))
      .sort()
      .join("|");

    return `${request.sourceText}\n/* __vtr_changed__:${normalizedChangedFiles} */\n`;
  }

  private async resolveRootTypeContext(
    request: ResolveRootTypeRequest,
    virtualFileName: string,
  ): Promise<ResolvedRootTypeContext | { ok: false; reason: string }> {
    const changedFiles = new Set<string>([virtualFileName]);

    for (const file of request.changedFiles ?? []) {
      changedFiles.add(this.normalizePath(file));
    }

    this.snapshotStats.incrementalAttempts += 1;
    const incremental = await this.tryResolveRootTypeContextWithFileChanges(
      request,
      virtualFileName,
      {
        changedFiles: [...changedFiles],
      },
    );

    if (incremental.ok) {
      this.snapshotMode = "incremental";
      this.snapshotStats.incrementalSuccesses += 1;
      return incremental;
    }

    if (!this.shouldFallbackToFullSnapshots(incremental.reason)) {
      return incremental;
    }

    this.recordSnapshotFallback(incremental.reason);

    if (incremental.reason.includes("source file not found")) {
      await this.resetClient();
    }

    this.snapshotStats.fullRebuilds += 1;
    const full = await this.tryResolveRootTypeContextWithFileChanges(request, virtualFileName, {
      changedFiles: [...changedFiles],
      invalidateAll: true,
    });
    this.snapshotMode = "full";
    return full;
  }

  private async tryResolveRootTypeContextWithFileChanges(
    request: ResolveRootTypeRequest,
    virtualFileName: string,
    fileChanges: SnapshotFileChanges,
  ): Promise<ResolvedRootTypeContext | { ok: false; reason: string }> {
    try {
      return await this.resolveRootTypeContextWithFileChanges(
        request,
        virtualFileName,
        fileChanges,
      );
    } catch (error) {
      return {
        ok: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async resolveRootTypeContextWithFileChanges(
    request: ResolveRootTypeRequest,
    virtualFileName: string,
    fileChanges: SnapshotFileChanges,
  ): Promise<ResolvedRootTypeContext | { ok: false; reason: string }> {
    const snapshot = await this.client.request<UpdateSnapshotResponse>("updateSnapshot", {
      openProject: request.projectFile,
      fileChanges,
    });

    const project = snapshot.projects.find((entry) => entry.configFileName === request.projectFile);

    if (!project) {
      return { ok: false, reason: `project not found for ${request.projectFile}` };
    }

    const syntacticDiagnostics = await this.client.request<DiagnosticResponse[]>(
      "getSyntacticDiagnostics",
      {
        snapshot: snapshot.snapshot,
        project: project.id,
        file: virtualFileName,
      },
    );

    if (syntacticDiagnostics.length > 0) {
      return {
        ok: false,
        reason: this.formatDiagnostics("syntactic", syntacticDiagnostics),
      };
    }

    const semanticDiagnostics = await this.client.request<DiagnosticResponse[]>(
      "getSemanticDiagnostics",
      {
        snapshot: snapshot.snapshot,
        project: project.id,
        file: virtualFileName,
      },
    );

    const actionableSemanticDiagnostics = semanticDiagnostics.filter(
      (diagnostic) => !this.isIgnorableSemanticDiagnostic(diagnostic, request.targetName),
    );

    if (actionableSemanticDiagnostics.length > 0) {
      return {
        ok: false,
        reason: this.formatDiagnostics("semantic", actionableSemanticDiagnostics),
      };
    }

    const symbol = await this.client.request<{ id: string } | null>("resolveName", {
      snapshot: snapshot.snapshot,
      project: project.id,
      name: request.targetName,
      meaning: TYPE_ALIAS_MEANING,
      file: virtualFileName,
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

  private shouldFallbackToFullSnapshots(reason: string): boolean {
    return (
      reason.includes("source file not found") ||
      reason.includes("synthetic target type was not resolved")
    );
  }

  private recordSnapshotFallback(reason: string): void {
    if (reason.includes("source file not found")) {
      this.snapshotStats.fallbacks.sourceFileNotFound += 1;
      return;
    }

    if (reason.includes("synthetic target type was not resolved")) {
      this.snapshotStats.fallbacks.syntheticTargetTypeNotResolved += 1;
    }
  }

  private async describeProperties(
    resolved: ResolvedRootTypeContext,
    typeId: string,
    depth: number,
    seen: Set<string>,
  ): Promise<RootTypePropertyDescription[]> {
    const properties = await this.client.request<TsgoSymbolResponse[]>("getPropertiesOfType", {
      snapshot: resolved.snapshotId,
      project: resolved.projectId,
      type: typeId,
    });

    const described: RootTypePropertyDescription[] = [];

    for (const property of properties) {
      if (this.isUnsupportedPropertyKey(property)) {
        described.push({
          name: property.name,
          optional: Boolean(property.flags & OPTIONAL_FLAG),
          readonly: this.isReadonlyProperty(property),
          unsupportedKey: true,
          kind: "reference",
          typeName: "unknown",
        });
        continue;
      }

      const propertyType = await this.client.request<TsgoTypeResponse | null>("getTypeOfSymbol", {
        snapshot: resolved.snapshotId,
        project: resolved.projectId,
        symbol: property.id,
      });

      described.push({
        name: property.name,
        optional: Boolean(property.flags & OPTIONAL_FLAG),
        readonly: this.isReadonlyProperty(property),
        ...(await this.describePropertyValue(resolved, propertyType, depth, seen)),
      });
    }

    return described;
  }

  private async describeIndexInfos(
    resolved: ResolvedRootTypeContext,
  ): Promise<RootTypeIndexInfoDescription[]> {
    const indexInfos = await this.client.request<TsgoIndexInfoResponse[]>("getIndexInfosOfType", {
      snapshot: resolved.snapshotId,
      project: resolved.projectId,
      type: resolved.typeId,
    });

    const described: RootTypeIndexInfoDescription[] = [];

    for (const indexInfo of indexInfos) {
      const keyType = await this.client.request<string>("typeToString", {
        snapshot: resolved.snapshotId,
        project: resolved.projectId,
        type: indexInfo.keyType.id,
      });

      described.push({
        keyType,
        readonly: indexInfo.isReadonly,
      });
    }

    return described;
  }

  private async describePropertyValue(
    resolved: ResolvedRootTypeContext,
    propertyType: TsgoTypeResponse | null,
    depth: number,
    seen: Set<string>,
  ): Promise<Pick<RootTypePropertyDescription, "kind" | "typeName" | "value" | "properties">> {
    const typeText =
      propertyType &&
      (await this.client.request<string>("typeToString", {
        snapshot: resolved.snapshotId,
        project: resolved.projectId,
        type: propertyType.id,
      }));

    if (!typeText) {
      return { kind: "reference", typeName: "unknown" };
    }

    if (PRIMITIVE_TYPE_NAMES.has(typeText)) {
      return { kind: "primitive", typeName: typeText };
    }

    if (typeText === "true" || typeText === "false") {
      return { kind: "literal", value: typeText === "true" };
    }

    if (/^"(?:[^"\\]|\\.)*"$/.test(typeText)) {
      return { kind: "literal", value: JSON.parse(typeText) as string };
    }

    if (/^-?\d+(\.\d+)?$/.test(typeText)) {
      return { kind: "literal", value: Number(typeText) };
    }

    if (propertyType) {
      const inlineObject = await this.describeInlineObject(
        resolved,
        propertyType,
        typeText,
        depth,
        seen,
      );
      if (inlineObject) {
        return inlineObject;
      }
    }

    return { kind: "reference", typeName: typeText };
  }

  private async describeInlineObject(
    resolved: ResolvedRootTypeContext,
    propertyType: TsgoTypeResponse,
    typeText: string,
    depth: number,
    seen: Set<string>,
  ): Promise<Pick<RootTypePropertyDescription, "kind" | "properties"> | null> {
    const objectFlags = propertyType.objectFlags ?? 0;

    if (
      depth >= MAX_INLINE_OBJECT_DEPTH ||
      seen.has(propertyType.id) ||
      this.isFunctionType(typeText) ||
      (objectFlags & OBJECT_FLAG_CLASS) !== 0 ||
      (objectFlags & OBJECT_FLAG_REFERENCE) !== 0 ||
      (objectFlags & (OBJECT_FLAG_INTERFACE | OBJECT_FLAG_ANONYMOUS)) === 0
    ) {
      return null;
    }

    const properties = await this.client.request<TsgoSymbolResponse[]>("getPropertiesOfType", {
      snapshot: resolved.snapshotId,
      project: resolved.projectId,
      type: propertyType.id,
    });

    if (properties.length === 0) {
      return null;
    }

    const indexInfos = await this.client.request<TsgoIndexInfoResponse[]>("getIndexInfosOfType", {
      snapshot: resolved.snapshotId,
      project: resolved.projectId,
      type: propertyType.id,
    });

    if (indexInfos.length > 0 || this.shouldKeepReferenceRuntimeType(typeText, properties)) {
      return null;
    }

    const nextSeen = new Set(seen);
    nextSeen.add(propertyType.id);

    return {
      kind: "object",
      properties: await this.describeProperties(resolved, propertyType.id, depth + 1, nextSeen),
    };
  }

  private shouldKeepReferenceRuntimeType(
    typeText: string,
    properties: TsgoSymbolResponse[],
  ): boolean {
    if (typeText.endsWith("Constructor")) {
      return true;
    }

    if (KNOWN_RUNTIME_OBJECT_REFERENCES.has(typeText)) {
      return true;
    }

    return (
      properties.length > 0 &&
      properties.every((property) => this.isDeclaredInTypeScriptLib(property))
    );
  }

  private isDeclaredInTypeScriptLib(symbol: TsgoSymbolResponse): boolean {
    const declarationHandle = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declarationHandle) {
      return false;
    }

    const parsed = this.parseDeclarationHandle(declarationHandle);
    if (!parsed) {
      return false;
    }

    return basename(parsed.fileName).startsWith("lib.");
  }

  private isUnsupportedPropertyKey(symbol: TsgoSymbolResponse): boolean {
    if (symbol.name.includes("\ufffd@")) {
      return true;
    }

    const declarationHandle = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declarationHandle) {
      return false;
    }

    const declarationText = this.readDeclarationText(declarationHandle);
    if (!declarationText) {
      return false;
    }

    const trimmed = declarationText.trimStart();
    if (!trimmed.startsWith("[")) {
      return false;
    }

    if (/^\[\s*[^:\]]+\s+in\s+/.test(trimmed)) {
      return false;
    }

    return !/^\[\s*(?:`(?:[^`\\]|\\.)*`|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|-?\d+(?:\.\d+)?)\s*\]\s*:/.test(
      trimmed,
    );
  }

  private isFunctionType(typeText: string): boolean {
    return typeText.includes("=>");
  }

  private isReadonlyProperty(symbol: TsgoSymbolResponse): boolean {
    if (symbol.flags & READONLY_FLAG) {
      return true;
    }

    const declarationHandle = symbol.valueDeclaration ?? symbol.declarations?.[0];
    if (!declarationHandle) {
      return false;
    }

    const declarationText = this.readDeclarationText(declarationHandle);
    return declarationText ? /^\s*readonly\b/.test(declarationText) : false;
  }

  private readDeclarationText(handle: string): string | null {
    const parsed = this.parseDeclarationHandle(handle);
    if (!parsed) {
      return null;
    }

    const content = this.readSourceText(parsed.fileName);
    if (content === null) {
      return null;
    }

    return content.slice(parsed.start, parsed.end);
  }

  private readSourceText(path: string): string | null {
    const normalizedPath = this.normalizePath(path);
    const virtualContent = this.virtualFiles.get(normalizedPath);
    if (virtualContent !== undefined) {
      return virtualContent;
    }

    try {
      return readFileSync(normalizedPath, "utf8");
    } catch {
      return null;
    }
  }

  private parseDeclarationHandle(
    handle: string,
  ): { start: number; end: number; fileName: string } | null {
    const firstDot = handle.indexOf(".");
    const secondDot = handle.indexOf(".", firstDot + 1);
    const thirdDot = handle.indexOf(".", secondDot + 1);

    if (firstDot < 0 || secondDot < 0 || thirdDot < 0) {
      return null;
    }

    const start = Number(handle.slice(0, firstDot));
    const end = Number(handle.slice(firstDot + 1, secondDot));
    const fileName = handle.slice(thirdDot + 1);

    if (!Number.isFinite(start) || !Number.isFinite(end) || fileName.length === 0) {
      return null;
    }

    return { start, end, fileName };
  }

  private normalizePath(path: string): string {
    return normalize(isAbsolute(path) ? path : resolve(this.root, path));
  }

  private readVirtualFile(path: string): { content: string } | null {
    const content = this.virtualFiles.get(this.normalizePath(path));
    return content === undefined ? null : { content };
  }

  private virtualFileExists(path: string): boolean | null {
    return this.virtualFiles.has(this.normalizePath(path)) ? true : null;
  }

  private virtualDirectoryExists(path: string): boolean | null {
    return this.isVirtualDirectory(path) ? true : null;
  }

  private getAccessibleEntries(path: string): AccessibleEntriesResponse | null {
    const directoryPath = this.normalizePath(path);
    const files = new Set<string>();
    const directories = new Set<string>();

    try {
      for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          directories.add(entry.name);
        } else {
          files.add(entry.name);
        }
      }
    } catch {}

    for (const virtualFileName of this.virtualFiles.keys()) {
      const rel = relative(directoryPath, virtualFileName);
      if (rel === "" || rel.startsWith(`..${sep}`) || rel === ".." || isAbsolute(rel)) {
        continue;
      }

      const parts = rel.split(sep).filter(Boolean);
      if (parts.length === 1) {
        files.add(basename(virtualFileName));
      } else if (parts.length > 1) {
        directories.add(parts[0]);
      }
    }

    if (files.size === 0 && directories.size === 0) {
      return null;
    }

    return {
      files: [...files].sort(),
      directories: [...directories].sort(),
    };
  }

  private getVirtualRealpath(path: string): string | null {
    const normalizedPath = this.normalizePath(path);

    if (!this.virtualFiles.has(normalizedPath) && !this.isVirtualDirectory(normalizedPath)) {
      return null;
    }

    try {
      return realpathSync.native(normalizedPath);
    } catch {
      return normalizedPath;
    }
  }

  private isVirtualDirectory(path: string): boolean {
    const directoryPath = this.normalizePath(path);

    for (const virtualFileName of this.virtualFiles.keys()) {
      const rel = relative(directoryPath, virtualFileName);
      if (rel !== "" && !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel)) {
        return true;
      }
    }

    return false;
  }

  private formatDiagnostics(kind: string, diagnostics: DiagnosticResponse[]): string {
    const first = diagnostics[0];
    const fileName = first.fileName ?? "virtual analysis module";
    return `${kind} diagnostics in ${fileName}: ${first.text}`;
  }

  private isIgnorableSemanticDiagnostic(
    diagnostic: DiagnosticResponse,
    targetName: string,
  ): boolean {
    return (
      diagnostic.text.includes("is declared but never used") &&
      (diagnostic.text.includes(targetName) || /__VTR_[A-Za-z]+Target_\d+/.test(diagnostic.text))
    );
  }

  private enqueueResolution<T>(task: () => Promise<T>): Promise<T> {
    const run = this.resolutionQueue.then(
      () => {
        if (this.closed) {
          throw new Error("TsgoSession is closed");
        }

        return task();
      },
      () => {
        if (this.closed) {
          throw new Error("TsgoSession is closed");
        }

        return task();
      },
    );
    this.resolutionQueue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
}
