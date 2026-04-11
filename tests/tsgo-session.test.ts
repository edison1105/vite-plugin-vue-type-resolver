import { existsSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vite-plus/test";

import { TsgoClient } from "../src/tsgo/client";
import { materializeRootProps } from "../src/materialize/materializeRootProps";
import { printTypeLiteral } from "../src/materialize/printTypeLiteral";
import { buildAnalysisModule } from "../src/virtual/buildAnalysisModule";
import { TsgoSession } from "../src/tsgo/session";
import { createFixtureProject } from "./helpers/createFixtureProject";

type ClientRequestMethod = <TResult>(
  this: TsgoClient,
  method: string,
  params?: unknown,
) => Promise<TResult>;

describe("TsgoSession", () => {
  test("describes imported local props as materializer-ready root data", async () => {
    const targetName = "__VTR_Target_Describe_Local";
    const sourceText = buildAnalysisModule({
      imports: ["import type { Props } from './types'"],
      localDeclarations: [],
      targetTypeText: "Props",
      targetName,
    });

    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
      "src/types.ts": `
export interface Props {
  readonly foo: string
  bar?: number
  tuple: readonly [string, ...number[]]
}
`,
    });

    const session = new TsgoSession({ root: project.root });
    try {
      const described = await session.describeRootType({
        projectFile: `${project.root}/tsconfig.json`,
        virtualFileName: `${project.root}/src/App.vue.ts`,
        sourceText,
        targetName,
      });

      expect(described.ok).toBe(true);
      if (!described.ok) return;

      expect(
        described.type.properties.map((prop) => ({
          name: prop.name,
          optional: prop.optional,
          readonly: prop.readonly,
          typeName: prop.typeName,
        })),
      ).toEqual([
        { name: "foo", optional: false, readonly: true, typeName: "string" },
        { name: "bar", optional: true, readonly: false, typeName: "number | undefined" },
        {
          name: "tuple",
          optional: false,
          readonly: false,
          typeName: "readonly [string, ...number[]]",
        },
      ]);
      expect(described.type.indexInfos).toEqual([]);

      const materialized = await materializeRootProps({ type: described.type });
      expect(materialized.ok).toBe(true);
      if (!materialized.ok) return;
      expect(printTypeLiteral(materialized.props)).toBe(
        "{\n  readonly foo: string\n  bar?: number\n  tuple: readonly [string, ...number[]]\n}",
      );
      expect(existsSync(`${project.root}/src/App.vue.ts`)).toBe(false);
    } finally {
      await session.close();
    }
  });

  test("describes global and third-party visible types through the bridge", async () => {
    const targetName = "__VTR_Target_Describe_Global";
    const sourceText = buildAnalysisModule({
      imports: ["import type { ThirdPartyProps } from 'third-party-lib'"],
      localDeclarations: [],
      targetTypeText: "GlobalProps & ThirdPartyProps",
      targetName,
    });

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
      "src/global.d.ts":
        "declare global { interface GlobalProps { readonly fromGlobal: string } } export {};",
      "node_modules/third-party-lib/index.d.ts":
        "export interface ThirdPartyProps { fromLib: boolean }",
    });

    const session = new TsgoSession({ root: project.root });
    try {
      const described = await session.describeRootType({
        projectFile: `${project.root}/tsconfig.json`,
        virtualFileName: `${project.root}/src/App.vue.ts`,
        sourceText,
        targetName,
      });

      expect(described.ok).toBe(true);
      if (!described.ok) return;

      expect(
        described.type.properties.map((prop) => ({
          name: prop.name,
          readonly: prop.readonly,
          typeName: prop.typeName,
        })),
      ).toEqual([
        { name: "fromGlobal", readonly: true, typeName: "string" },
        { name: "fromLib", readonly: false, typeName: "boolean" },
      ]);
      expect(described.type.indexInfos).toEqual([]);
      expect(existsSync(`${project.root}/src/App.vue.ts`)).toBe(false);
    } finally {
      await session.close();
    }
  });

  test("detects readonly props from mapped utility types", async () => {
    const targetName = "__VTR_Target_Readonly_Mapped";
    const sourceText = buildAnalysisModule({
      imports: ["import type { Props } from './types'"],
      localDeclarations: [],
      targetTypeText: "Readonly<Props>",
      targetName,
    });

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

    const session = new TsgoSession({ root: project.root });
    try {
      const described = await session.describeRootType({
        projectFile: `${project.root}/tsconfig.json`,
        virtualFileName: `${project.root}/src/App.vue.ts`,
        sourceText,
        targetName,
      });

      expect(described.ok).toBe(true);
      if (!described.ok) return;

      expect(
        described.type.properties.map((prop) => ({
          name: prop.name,
          optional: prop.optional,
          readonly: prop.readonly,
        })),
      ).toEqual([
        { name: "foo", optional: false, readonly: true },
        { name: "bar", optional: true, readonly: true },
      ]);
      expect(existsSync(`${project.root}/src/App.vue.ts`)).toBe(false);
    } finally {
      await session.close();
    }
  });

  test("lowers string literal property types truthfully", async () => {
    const targetName = "__VTR_Target_String_Literal";
    const sourceText = buildAnalysisModule({
      imports: ["import type { Props } from './types'"],
      localDeclarations: [],
      targetTypeText: "Props",
      targetName,
    });

    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
      "src/types.ts": `
export interface Props {
  theme: "dark"
}
`,
    });

    const session = new TsgoSession({ root: project.root });
    try {
      const described = await session.describeRootType({
        projectFile: `${project.root}/tsconfig.json`,
        virtualFileName: `${project.root}/src/App.vue.ts`,
        sourceText,
        targetName,
      });

      expect(described.ok).toBe(true);
      if (!described.ok) return;

      expect(described.type.properties).toEqual([
        {
          name: "theme",
          optional: false,
          readonly: false,
          kind: "literal",
          value: "dark",
        },
      ]);

      const materialized = await materializeRootProps({ type: described.type });
      expect(materialized.ok).toBe(true);
      if (!materialized.ok) return;
      expect(printTypeLiteral(materialized.props)).toBe('{\n  theme: "dark"\n}');
      expect(existsSync(`${project.root}/src/App.vue.ts`)).toBe(false);
    } finally {
      await session.close();
    }
  });

  test("keeps open index signatures visible for materializer fallback", async () => {
    const targetName = "__VTR_Target_Record";
    const sourceText = buildAnalysisModule({
      imports: [],
      localDeclarations: [],
      targetTypeText: "Record<string, string>",
      targetName,
    });

    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });

    const session = new TsgoSession({ root: project.root });
    try {
      const described = await session.describeRootType({
        projectFile: `${project.root}/tsconfig.json`,
        virtualFileName: `${project.root}/src/App.vue.ts`,
        sourceText,
        targetName,
      });

      expect(described.ok).toBe(true);
      if (!described.ok) return;

      expect(described.type.properties).toEqual([]);
      expect(described.type.indexInfos).toEqual([{ keyType: "string", readonly: false }]);

      const materialized = await materializeRootProps({ type: described.type });
      expect(materialized.ok).toBe(false);
      if (materialized.ok) return;
      expect(materialized.reason).toBe("open-index-signature");
      expect(existsSync(`${project.root}/src/App.vue.ts`)).toBe(false);
    } finally {
      await session.close();
    }
  });

  test("resolves imported local props types", async () => {
    const targetName = "__VTR_Target_Local";
    const sourceText = buildAnalysisModule({
      imports: ["import type { Props } from './types'"],
      localDeclarations: [],
      targetTypeText: "Props",
      targetName,
    });

    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
      "src/types.ts": "export interface Props { foo: string; bar?: number }",
    });

    const session = new TsgoSession({ root: project.root });
    try {
      const resolved = await session.resolveRootType({
        projectFile: `${project.root}/tsconfig.json`,
        virtualFileName: `${project.root}/src/App.vue.ts`,
        sourceText,
        targetName,
      });

      expect(resolved.ok).toBe(true);
      if (resolved.ok) {
        expect(resolved.typeId.length).toBeGreaterThan(0);
      }
      expect(existsSync(`${project.root}/src/App.vue.ts`)).toBe(false);
    } finally {
      await session.close();
    }
  });

  test("resolves global and third-party types available to the project", async () => {
    const targetName = "__VTR_Target_Global";
    const sourceText = buildAnalysisModule({
      imports: ["import type { ThirdPartyProps } from 'third-party-lib'"],
      localDeclarations: [],
      targetTypeText: "GlobalProps & ThirdPartyProps",
      targetName,
    });

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
      "src/global.d.ts":
        "declare global { interface GlobalProps { fromGlobal: string } } export {};",
      "node_modules/third-party-lib/index.d.ts":
        "export interface ThirdPartyProps { fromLib: boolean }",
    });

    const session = new TsgoSession({ root: project.root });
    try {
      const resolved = await session.resolveRootType({
        projectFile: `${project.root}/tsconfig.json`,
        virtualFileName: `${project.root}/src/App.vue.ts`,
        sourceText,
        targetName,
      });

      expect(resolved.ok).toBe(true);
      expect(existsSync(`${project.root}/src/App.vue.ts`)).toBe(false);
    } finally {
      await session.close();
    }
  });

  test("fails when the virtual analysis module has semantic diagnostics", async () => {
    const targetName = "__VTR_Target_Invalid";
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });

    const session = new TsgoSession({ root: project.root });
    try {
      const resolved = await session.resolveRootType({
        projectFile: `${project.root}/tsconfig.json`,
        virtualFileName: `${project.root}/src/App.vue.ts`,
        sourceText: buildAnalysisModule({
          imports: [],
          localDeclarations: [],
          targetTypeText: "MissingProps",
          targetName,
        }),
        targetName,
      });

      expect(resolved.ok).toBe(false);
      if (!resolved.ok) {
        expect(resolved.reason).toContain("diagnostic");
      }
      expect(existsSync(`${project.root}/src/App.vue.ts`)).toBe(false);
    } finally {
      await session.close();
    }
  });

  test("serializes overlapping resolutions on the same session", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
      "src/types.ts": `
export interface AlphaProps { alpha: string }
export interface BetaProps { beta: number }
`,
    });

    const session = new TsgoSession({ root: project.root });
    try {
      const [alpha, beta] = await Promise.all([
        session.resolveRootType({
          projectFile: `${project.root}/tsconfig.json`,
          virtualFileName: `${project.root}/src/App.vue.ts`,
          sourceText: buildAnalysisModule({
            imports: ["import type { AlphaProps } from './types'"],
            localDeclarations: [],
            targetTypeText: "AlphaProps",
            targetName: "__VTR_Target_Alpha",
          }),
          targetName: "__VTR_Target_Alpha",
        }),
        session.resolveRootType({
          projectFile: `${project.root}/tsconfig.json`,
          virtualFileName: `${project.root}/src/App.vue.ts`,
          sourceText: buildAnalysisModule({
            imports: ["import type { BetaProps } from './types'"],
            localDeclarations: [],
            targetTypeText: "BetaProps",
            targetName: "__VTR_Target_Beta",
          }),
          targetName: "__VTR_Target_Beta",
        }),
      ]);

      expect(alpha.ok).toBe(true);
      expect(beta.ok).toBe(true);
      expect(existsSync(`${project.root}/src/App.vue.ts`)).toBe(false);
    } finally {
      await session.close();
    }
  });

  test("does not accept new resolutions after close", async () => {
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
      "src/types.ts": "export interface Props { foo: string }",
    });

    const session = new TsgoSession({ root: project.root });
    await session.close();

    await expect(
      session.resolveRootType({
        projectFile: `${project.root}/tsconfig.json`,
        virtualFileName: `${project.root}/src/App.vue.ts`,
        sourceText: buildAnalysisModule({
          imports: ["import type { Props } from './types'"],
          localDeclarations: [],
          targetTypeText: "Props",
          targetName: "__VTR_Target_Closed",
        }),
        targetName: "__VTR_Target_Closed",
      }),
    ).rejects.toThrow(/closed/i);
  });

  test("updates snapshots with changed virtual files instead of full invalidation", async () => {
    const targetName = "__VTR_Target_Changed_Files";
    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });
    const virtualFileName = `${project.root}/src/App.vue.ts`;
    const sourceText = buildAnalysisModule({
      imports: [],
      localDeclarations: ["type Props = { foo: string }"],
      targetTypeText: "Props",
      targetName,
    });

    const originalRequest = Object.getOwnPropertyDescriptor(TsgoClient.prototype, "request")
      ?.value as ClientRequestMethod | undefined;
    const updateSnapshotParams: unknown[] = [];

    if (!originalRequest) {
      throw new Error("TsgoClient.request is unavailable");
    }

    TsgoClient.prototype.request = async function patchedRequest<TResult>(
      this: TsgoClient,
      method: string,
      params?: unknown,
    ): Promise<TResult> {
      if (method === "updateSnapshot") {
        updateSnapshotParams.push(params);
      }

      return Reflect.apply(originalRequest, this, [method, params]) as Promise<TResult>;
    };

    const session = new TsgoSession({ root: project.root });
    try {
      const described = await session.describeRootType({
        projectFile: `${project.root}/tsconfig.json`,
        virtualFileName,
        sourceText,
        targetName,
      });

      expect(described.ok).toBe(true);
      expect(updateSnapshotParams).toHaveLength(1);
      expect(updateSnapshotParams[0]).toMatchObject({
        openProject: `${project.root}/tsconfig.json`,
        fileChanges: {
          changedFiles: [expect.stringContaining(`${project.root}/src/__vtr__`)],
        },
      });
    } finally {
      TsgoClient.prototype.request = originalRequest;
      await session.close();
    }
  });

  test("tracks snapshot stats for successful incremental analysis", async () => {
    const targetName = "__VTR_Target_Snapshot_Stats";
    const sourceText = buildAnalysisModule({
      imports: [],
      localDeclarations: ["type Props = { foo: string }"],
      targetTypeText: "Props",
      targetName,
    });

    const project = createFixtureProject({
      "tsconfig.json": JSON.stringify({
        compilerOptions: { strict: true, module: "ESNext", moduleResolution: "Bundler" },
        include: ["src/**/*"],
      }),
    });

    const session = new TsgoSession({ root: project.root });
    try {
      const described = await session.describeRootType({
        projectFile: `${project.root}/tsconfig.json`,
        virtualFileName: `${project.root}/src/App.vue.ts`,
        sourceText,
        targetName,
      });

      expect(described.ok).toBe(true);
      expect(session.getSnapshotStats()).toEqual({
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
      await session.close();
    }
  });

  test("returns to incremental mode after a fallback full rebuild", async () => {
    const targetName = "__VTR_Target_Fallback_Recover";
    const sourceText = buildAnalysisModule({
      imports: ["import type { Props } from './types'"],
      localDeclarations: [],
      targetTypeText: "Props",
      targetName,
    });

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

    const session = new TsgoSession({ root: project.root });
    try {
      const first = await session.describeRootType({
        projectFile: `${project.root}/tsconfig.json`,
        virtualFileName: `${project.root}/src/App.vue.ts`,
        sourceText,
        targetName,
      });

      expect(first.ok).toBe(true);

      project.write(
        "src/types.ts",
        `
export interface Props {
  foo: number
}
`,
      );

      const second = await session.describeRootType({
        projectFile: `${project.root}/tsconfig.json`,
        virtualFileName: `${project.root}/src/App.vue.ts`,
        sourceText,
        targetName,
        changedFiles: [join(project.root, "src/types.ts")],
      });

      expect(second.ok).toBe(true);

      const third = await session.describeRootType({
        projectFile: `${project.root}/tsconfig.json`,
        virtualFileName: `${project.root}/src/App.vue.ts`,
        sourceText,
        targetName,
      });

      expect(third.ok).toBe(true);
      if (third.ok) {
        expect(third.type.properties).toEqual([
          {
            name: "foo",
            optional: false,
            readonly: false,
            kind: "primitive",
            typeName: "number",
          },
        ]);
      }

      expect(session.getSnapshotStats()).toEqual({
        currentMode: "incremental",
        incrementalAttempts: 3,
        incrementalSuccesses: 2,
        fullRebuilds: 1,
        fallbacks: {
          sourceFileNotFound: 0,
          syntheticTargetTypeNotResolved: 1,
        },
      });
    } finally {
      await session.close();
    }
  });
});
