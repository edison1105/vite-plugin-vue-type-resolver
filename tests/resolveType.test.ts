import { describe, expect, test } from "vite-plus/test";

import { resolveDefinePropsCase } from "./helpers/resolveDefinePropsCase";

const MOCK_VUE_HELPER_TYPES = `
export interface PropType<T> {
  readonly __propType?: T
}

type InferPropType<T> =
  T extends PropType<infer V> ? V :
  T extends StringConstructor ? string :
  T extends NumberConstructor ? number :
  T extends BooleanConstructor ? boolean :
  T extends ArrayConstructor ? unknown[] :
  T extends ObjectConstructor ? Record<string, unknown> :
  T extends { type: infer U } ? InferPropType<U> :
  unknown

type IsRequired<T> =
  T extends { required: true } ? true :
  T extends { default: unknown } ? true :
  false

type OptionalKeys<O> = {
  [K in keyof O]-?: IsRequired<O[K]> extends true ? never : K
}[keyof O]

type RequiredKeys<O> = Exclude<keyof O, OptionalKeys<O>>

export type ExtractPropTypes<O> = {
  [K in RequiredKeys<O>]: InferPropType<O[K]>
} & {
  [K in OptionalKeys<O>]?: InferPropType<O[K]>
}
`;

describe("resolveType compatibility", () => {
  test("type literal with special keys and function props", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
const props = defineProps<{
  foo: number
  bar: () => void
  'baz': string
  123: symbol
}>()
`,
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      123: { types: ["Symbol"], required: true, skipCheck: false },
      bar: { types: ["Function"], required: true, skipCheck: false },
      baz: { types: ["String"], required: true, skipCheck: false },
      foo: { types: ["Number"], required: true, skipCheck: false },
    });
  });

  test("reference interface extends", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
export interface A { a: () => void }
export interface B extends A { b: boolean }
interface C { c: string }
interface Props extends B, C { foo: number }
const props = defineProps<Props>()
`,
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      a: { types: ["Function"], required: true, skipCheck: false },
      b: { types: ["Boolean"], required: true, skipCheck: false },
      c: { types: ["String"], required: true, skipCheck: false },
      foo: { types: ["Number"], required: true, skipCheck: false },
    });
  });

  test("intersection type narrows shared members with TS checker semantics", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
type Foo = { foo: number }
type Bar = { bar: string }
type Baz = { bar: string | boolean }
const props = defineProps<Foo & Bar & Baz>()
`,
    });

    expect(result.warnings).toEqual([]);
    // Vue's copied resolveType expectation keeps the wider `string | boolean` member,
    // but the TS checker reduces `string & (string | boolean)` to `string`.
    // The plugin intentionally follows the final checked root type here.
    expect(result.runtimeProps).toEqual({
      bar: { types: ["String"], required: true, skipCheck: false },
      foo: { types: ["Number"], required: true, skipCheck: false },
    });
  });

  test("conditional union only materializes properties on the final TS root type", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
interface CommonProps {
  size?: 'xl' | 'l' | 'm' | 's' | 'xs'
}

type ConditionalProps =
  | {
      color: 'normal' | 'primary' | 'secondary'
      appearance: 'normal' | 'outline' | 'text'
    }
  | {
      color: number
      appearance: 'outline'
      note: string
    }

const props = defineProps<CommonProps & ConditionalProps>()
`,
    });

    expect(result.warnings).toEqual([]);
    // `note` exists on only one union branch. The TS checker does not expose it as a
    // property of `CommonProps & ConditionalProps`, so we intentionally omit it instead
    // of reproducing Vue's wider historical AST-based merge behavior.
    expect(result.runtimeProps).toEqual({
      appearance: { types: ["String"], required: true, skipCheck: false },
      color: { types: ["Number", "String"], required: true, skipCheck: false },
      size: { types: ["String"], required: false, skipCheck: false },
    });
  });

  test("template string mapped keys", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
type T = 'foo' | 'bar'
type S = 'x' | 'y'
const props = defineProps<{
  [K in \`_\${T}_\${S}_\`]: string
}>()
`,
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      _bar_x_: { types: ["String"], required: true, skipCheck: false },
      _bar_y_: { types: ["String"], required: true, skipCheck: false },
      _foo_x_: { types: ["String"], required: true, skipCheck: false },
      _foo_y_: { types: ["String"], required: true, skipCheck: false },
    });
  });

  test("mapped types with string manipulation", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
type T = 'foo' | 'bar'
const props = defineProps<{ [K in T]: string | number } & {
  [K in 'optional']?: boolean
} & {
  [K in Capitalize<T>]: string
} & {
  [K in Uppercase<Extract<T, 'foo'>>]: string
} & {
  [K in \`x\${T}\`]: string
}>()
`,
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      Bar: { types: ["String"], required: true, skipCheck: false },
      FOO: { types: ["String"], required: true, skipCheck: false },
      Foo: { types: ["String"], required: true, skipCheck: false },
      bar: { types: ["Number", "String"], required: true, skipCheck: false },
      foo: { types: ["Number", "String"], required: true, skipCheck: false },
      optional: { types: ["Boolean"], required: false, skipCheck: false },
      xbar: { types: ["String"], required: true, skipCheck: false },
      xfoo: { types: ["String"], required: true, skipCheck: false },
    });
  });

  test("utility types Partial, Required, Pick, and Omit", async () => {
    const partial = await resolveDefinePropsCase({
      scriptSetup: `
type T = { foo: number, bar: string }
const props = defineProps<Partial<T>>()
`,
    });

    const required = await resolveDefinePropsCase({
      scriptSetup: `
type T = { foo?: number, bar?: string }
const props = defineProps<Required<T>>()
`,
    });

    const picked = await resolveDefinePropsCase({
      scriptSetup: `
type T = { foo: number, bar: string, baz: boolean }
type K = 'foo' | 'bar'
const props = defineProps<Pick<T, K>>()
`,
    });

    const omitted = await resolveDefinePropsCase({
      scriptSetup: `
type T = { foo: number, bar: string, baz: boolean }
type K = 'foo' | 'bar'
const props = defineProps<Omit<T, K>>()
`,
    });

    expect(partial.warnings).toEqual([]);
    expect(required.warnings).toEqual([]);
    expect(picked.warnings).toEqual([]);
    expect(omitted.warnings).toEqual([]);

    expect(partial.runtimeProps).toEqual({
      bar: { types: ["String"], required: false, skipCheck: false },
      foo: { types: ["Number"], required: false, skipCheck: false },
    });
    expect(required.runtimeProps).toEqual({
      bar: { types: ["String"], required: true, skipCheck: false },
      foo: { types: ["Number"], required: true, skipCheck: false },
    });
    expect(picked.runtimeProps).toEqual({
      bar: { types: ["String"], required: true, skipCheck: false },
      foo: { types: ["Number"], required: true, skipCheck: false },
    });
    expect(omitted.runtimeProps).toEqual({
      baz: { types: ["Boolean"], required: true, skipCheck: false },
    });
  });

  test("indexed access and typeof", async () => {
    const indexed = await resolveDefinePropsCase({
      scriptSetup: `
type A = (string | number)[]
type AA = Array<string>
type T = [1, 'foo']
declare const a: string
const props = defineProps<{
  foo: A[number]
  bar: AA[number]
  tuple: T[number]
  fromTypeof: typeof a
}>()
`,
    });

    expect(indexed.warnings).toEqual([]);
    expect(indexed.runtimeProps).toEqual({
      bar: { types: ["String"], required: true, skipCheck: false },
      foo: { types: ["Number", "String"], required: true, skipCheck: false },
      fromTypeof: { types: ["String"], required: true, skipCheck: false },
      tuple: { types: ["Number", "String"], required: true, skipCheck: false },
    });
  });

  test("keyof on imported and local object shapes", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
import type { IMP } from './foo'
interface Foo { foo: 1, 1: 1 }
type Bar = { bar: 1 }
declare const obj: Bar
declare const set: Set<any>
declare const arr: Array<any>

const props = defineProps<{
  imp: keyof IMP
  foo: keyof Foo
  bar: keyof Bar
  obj: keyof typeof obj
  set: keyof typeof set
  arr: keyof typeof arr
}>()
`,
      files: {
        "src/foo.ts": "export type IMP = { 1: 1 }",
      },
    });

    expect(result.warnings).toEqual([]);
    // For standard library instances, the checker text remains `keyof typeof ...`.
    // Vue's runtime inference then applies its own built-in heuristics instead of a
    // fully expanded PropertyKey union, so these two land differently from plain
    // object-shape keyof results.
    expect(result.runtimeProps).toEqual({
      arr: { types: ["Array"], required: true, skipCheck: false },
      bar: { types: ["String"], required: true, skipCheck: false },
      foo: { types: ["Number", "String"], required: true, skipCheck: false },
      imp: { types: ["Number"], required: true, skipCheck: false },
      obj: { types: ["String"], required: true, skipCheck: false },
      set: { types: ["String"], required: true, skipCheck: false },
    });
  });

  test("keyof on index signatures preserves primitive key kinds", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
declare const num: number

interface Foo {
  [key: symbol]: 1
  [key: string]: 1
  [key: typeof num]: 1
}

type Test<T> = T
type Bar = {
  [key: string]: 1
  [key: Test<number>]: 1
}

const props = defineProps<{
  foo: keyof Foo
  bar: keyof Bar
}>()
`,
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      bar: { types: ["Number", "String"], required: true, skipCheck: false },
      foo: { types: ["Number", "String", "Symbol"], required: true, skipCheck: false },
    });
  });

  test("keyof intersection and union follow TS checker semantics", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
type A = { name: string }
type Intersection = A & { [key: number]: string }
type Union = A | { [key: number]: string }

const props = defineProps<{
  intersection: keyof Intersection
  union: keyof Union
}>()
`,
    });

    expect(result.warnings).toEqual([]);
    // The copied Vue test expected the union case to stay widened. TS reduces
    // `keyof (A | { [key: number]: string })` to `never`, so we intentionally
    // follow the final checked type and let Vue infer a null runtime type.
    expect(result.runtimeProps).toEqual({
      intersection: { types: ["Number", "String"], required: true, skipCheck: false },
      union: { types: null, required: true, skipCheck: false },
    });
  });

  test("keyof utility helpers follow tsgo's final reduced key space", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
type Foo = Record<symbol | string, any>
type Bar = { [key: string]: any }
type AnyRecord = Record<keyof any, any>
type Baz = { a: 1, 1: 2, b: 3 }

const props = defineProps<{
  record: keyof Foo
  anyRecord: keyof AnyRecord
  partial: keyof Partial<Bar>
  required: keyof Required<Bar>
  readonly: keyof Readonly<Bar>
  pick: keyof Pick<Baz, 'a' | 1>
  extract: keyof Extract<keyof Baz, 'a' | 1>
}>()
`,
    });

    expect(result.warnings).toEqual([]);
    // These utility cases are worth pinning because tsgo does not normalize all of them
    // to the same broad `PropertyKey` union. In particular, `keyof Extract<...>` on the
    // primitive-literal branch reduces to the primitive member keys that Vue maps to String.
    expect(result.runtimeProps).toEqual({
      anyRecord: { types: ["Number", "String", "Symbol"], required: true, skipCheck: false },
      extract: { types: ["String"], required: true, skipCheck: false },
      partial: { types: ["Number", "String"], required: true, skipCheck: false },
      pick: { types: ["Number", "String"], required: true, skipCheck: false },
      readonly: { types: ["Number", "String"], required: true, skipCheck: false },
      record: { types: ["String", "Symbol"], required: true, skipCheck: false },
      required: { types: ["Number", "String"], required: true, skipCheck: false },
    });
  });

  test("keyof nested object access respects numeric and string literal members", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
type TypeNum = { deep: { 0: string; 1: string } }
type TypeStr = { deep: { home: string; about: string } }
interface Meta { route: 'x' }
interface WithIntermediate { deep: Meta }

const props = defineProps<{
  numericRoute: keyof TypeNum['deep']
  stringRoute: keyof TypeStr['deep']
  intermediateRoute: keyof WithIntermediate['deep']
}>()
`,
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      intermediateRoute: { types: ["String"], required: true, skipCheck: false },
      numericRoute: { types: ["Number"], required: true, skipCheck: false },
      stringRoute: { types: ["String"], required: true, skipCheck: false },
    });
  });

  test("namespace merging and external generic imports", async () => {
    const namespaceMerged = await resolveDefinePropsCase({
      scriptSetup: `
namespace Foo {
  export type A = string
}
namespace Foo {
  export type B = number
}
const props = defineProps<{
  foo: Foo.A
  bar: Foo.B
}>()
`,
    });

    const externalGeneric = await resolveDefinePropsCase({
      scriptSetup: `
import type { P } from './foo'
const props = defineProps<P<string>>()
`,
      files: {
        "src/foo.ts": "export type P<T> = { foo: T }",
      },
    });

    expect(namespaceMerged.warnings).toEqual([]);
    expect(externalGeneric.warnings).toEqual([]);

    expect(namespaceMerged.runtimeProps).toEqual({
      bar: { types: ["Number"], required: true, skipCheck: false },
      foo: { types: ["String"], required: true, skipCheck: false },
    });
    expect(externalGeneric.runtimeProps).toEqual({
      foo: { types: ["String"], required: true, skipCheck: false },
    });
  });

  test("namespace merging with interface members", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
namespace Foo {
  export type A = string
}

interface Foo {
  b: number
}

const props = defineProps<{
  foo: Foo.A
  bar: Foo['b']
}>()
`,
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      bar: { types: ["Number"], required: true, skipCheck: false },
      foo: { types: ["String"], required: true, skipCheck: false },
    });
  });

  test("enum merging keeps mixed primitive members", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
enum Foo {
  A = 1,
}

enum Foo {
  B = 'hi',
}

const props = defineProps<{
  foo: Foo
}>()
`,
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      foo: { types: ["Number", "String"], required: true, skipCheck: false },
    });
  });

  test("readonly arrays remain array runtime props", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
const props = defineProps<{
  foo: readonly unknown[]
}>()
`,
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      foo: { types: ["Array"], required: true, skipCheck: false },
    });
  });

  test("relative chained re-exports and default re-exports", async () => {
    const exportStar = await resolveDefinePropsCase({
      scriptSetup: `
import type { P } from './foo'
const props = defineProps<P>()
`,
      files: {
        "src/foo.ts": "export * from './bar'",
        "src/bar.ts": "export type P = { bar: string }",
      },
    });

    const defaultReExport = await resolveDefinePropsCase({
      scriptSetup: `
import P from './bar'
import PP from './baz'
const props = defineProps<P & PP>()
`,
      files: {
        "src/foo.ts": `
export default interface P { foo: string }
export interface PP { bar: number }
`,
        "src/bar.ts": "export { default } from './foo'",
        "src/baz.ts": "export { PP as default } from './foo'",
      },
    });

    expect(exportStar.warnings).toEqual([]);
    expect(defaultReExport.warnings).toEqual([]);

    expect(exportStar.runtimeProps).toEqual({
      bar: { types: ["String"], required: true, skipCheck: false },
    });
    expect(defaultReExport.runtimeProps).toEqual({
      bar: { types: ["Number"], required: true, skipCheck: false },
      foo: { types: ["String"], required: true, skipCheck: false },
    });
  });

  test("tsconfig path aliases resolve project and third-party-visible types", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
import type { BaseProps } from '@/types'
const props = defineProps<BaseProps>()
`,
      files: {
        "src/types.ts": "export type BaseProps = { foo?: string; bar?: string }",
      },
      compilerOptions: {
        baseUrl: ".",
        paths: {
          "@/*": ["src/*"],
        },
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      bar: { types: ["String"], required: false, skipCheck: false },
      foo: { types: ["String"], required: false, skipCheck: false },
    });
  });

  test("global ambient types visible to the project", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
const props = defineProps<GlobalProps>()
`,
      files: {
        "src/global-types.d.ts": `
declare global {
  interface GlobalProps {
    foo: string
    bar?: number
  }
}
export {}
`,
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      bar: { types: ["Number"], required: false, skipCheck: false },
      foo: { types: ["String"], required: true, skipCheck: false },
    });
  });

  test("global ambient named exports and indexed access stay visible", async () => {
    const exportedGlobal = await resolveDefinePropsCase({
      scriptSetup: `
const props = defineProps<ExportedInterface>()
`,
      files: {
        "src/global-exported.d.ts": `
declare global {
  export interface ExportedInterface {
    foo: number
  }
}
export {}
`,
      },
    });

    const indexedAccess = await resolveDefinePropsCase({
      scriptSetup: `
const props = defineProps<Options["code"]>()
`,
      files: {
        "src/global-options.d.ts": `
declare global {
  type Options = {
    code: {
      selected: boolean
    }
  }
}
export {}
`,
      },
    });

    expect(exportedGlobal.warnings).toEqual([]);
    expect(indexedAccess.warnings).toEqual([]);

    expect(exportedGlobal.runtimeProps).toEqual({
      foo: { types: ["Number"], required: true, skipCheck: false },
    });
    expect(indexedAccess.runtimeProps).toEqual({
      selected: { types: ["Boolean"], required: true, skipCheck: false },
    });
  });

  test("ExtractPropTypes resolves imported Vue helper types", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
import type { ExtractPropTypes } from 'vue'

declare const props: {
  foo: StringConstructor
  bar: {
    type: import('foo').EpPropFinalized<BooleanConstructor>
    required: true
  }
}

      type Props = ExtractPropTypes<typeof props>
const resolved = defineProps<Props>()
`,
      files: {
        "node_modules/vue/package.json": '{"types":"index.d.ts"}',
        "node_modules/vue/index.d.ts": MOCK_VUE_HELPER_TYPES,
        "node_modules/foo/package.json": '{"types":"index.d.ts"}',
        "node_modules/foo/index.d.ts": `
export type EpPropFinalized<T> = {
  type: T
  required: true
}
`,
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      bar: { types: ["Boolean"], required: true, skipCheck: false },
      foo: { types: ["String"], required: false, skipCheck: false },
    });
  });

  test("import-type ExtractPropTypes works through Partial and ReturnType", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
declare const props: () => {
  foo: StringConstructor
  bar: { type: import('vue').PropType<boolean> }
}

type Props = Partial<import('vue').ExtractPropTypes<ReturnType<typeof props>>>
const resolved = defineProps<Props>()
`,
      files: {
        "node_modules/vue/package.json": '{"types":"index.d.ts"}',
        "node_modules/vue/index.d.ts": MOCK_VUE_HELPER_TYPES,
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      bar: { types: ["Boolean"], required: false, skipCheck: false },
      foo: { types: ["String"], required: false, skipCheck: false },
    });
  });

  test("ExtractPropTypes preserves declared function generic return shapes", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
import type { ExtractPropTypes, PropType } from 'vue'

interface UploadFile<T = any> {
  xhr?: T
}

declare function uploadProps<T = any>(): {
  fileList: {
    type: PropType<UploadFile<T>[]>
    default: UploadFile<T>[]
  }
}

type UploadProps = ExtractPropTypes<ReturnType<typeof uploadProps>>
const resolved = defineProps<UploadProps>()
`,
      files: {
        "node_modules/vue/package.json": '{"types":"index.d.ts"}',
        "node_modules/vue/index.d.ts": MOCK_VUE_HELPER_TYPES,
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      fileList: { types: ["Array"], required: true, skipCheck: false },
    });
  });

  test("falls back with a warning on open index signatures", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
const props = defineProps<Record<string, string>>()
`,
      compile: false,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Failed to materialize defineProps type");
    expect(result.transformed).toContain("defineProps<Record<string, string>>()");
  });

  test("falls back with a warning when an import source cannot be resolved", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
import type { MissingProps } from 'missing-package'
const props = defineProps<MissingProps>()
`,
      compile: false,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Failed to analyze defineProps type");
    expect(result.transformed).toContain("defineProps<MissingProps>()");
  });

  test("falls back with a warning when a local type reference cannot be resolved", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
const props = defineProps<LocalMissing>()
`,
      compile: false,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Failed to analyze defineProps type");
    expect(result.transformed).toContain("defineProps<LocalMissing>()");
  });

  test("falls back with a warning on unsupported index access roots", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
const props = defineProps<X[K]>()
`,
      compile: false,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Failed to analyze defineProps type");
    expect(result.transformed).toContain("defineProps<X[K]>()");
  });

  test("falls back with a warning on computed unique-symbol keys", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
declare const Foo: unique symbol
const props = defineProps<{ [Foo]: string }>()
`,
      compile: false,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("Failed to materialize defineProps type");
    expect(result.transformed).toContain("defineProps<{ [Foo]: string }>()");
  });

  test("nested ambient references materialize as object runtime props", async () => {
    const result = await resolveDefinePropsCase({
      scriptSetup: `
const props = defineProps<App.Data.AircraftData>()
`,
      files: {
        "src/backend.d.ts": `
declare namespace App.Data {
  export type AircraftData = {
    id: string
    manufacturer: App.Data.Listings.ManufacturerData
  }
}
declare namespace App.Data.Listings {
  export type ManufacturerData = {
    id: string
  }
}
`,
      },
    });

    expect(result.warnings).toEqual([]);
    expect(result.runtimeProps).toEqual({
      id: { types: ["String"], required: true, skipCheck: false },
      manufacturer: { types: ["Object"], required: true, skipCheck: false },
    });
  });
});
