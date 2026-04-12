import { describe, expect, test } from "vite-plus/test";

import { compileDefineEmitsCase, resolveDefineEmitsCase } from "./helpers/resolveDefineEmitsCase";

async function expectRuntimeEmits(
  scriptSetup: string,
  expected: string[],
  options?: {
    script?: string;
    files?: Record<string, string>;
    compilerOptions?: Record<string, unknown>;
  },
) {
  const result = await resolveDefineEmitsCase({
    scriptSetup,
    script: options?.script,
    files: options?.files,
    compilerOptions: options?.compilerOptions,
  });

  expect(result.warnings).toEqual([]);
  expect(result.runtimeEmits).toEqual([...expected].sort());
}

describe("defineEmits compatibility", () => {
  test("runtime array args stay compatible", async () => {
    await expectRuntimeEmits(`const emit = defineEmits(["foo", "bar"])`, ["foo", "bar"]);
  });

  test("typed function syntax stays compatible", async () => {
    await expectRuntimeEmits(`const emit = defineEmits<(e: "foo" | "bar") => void>()`, [
      "foo",
      "bar",
    ]);
  });

  test("unioned function types stay compatible", async () => {
    await expectRuntimeEmits(
      `const emit = defineEmits<((e: "foo" | "bar") => void) | ((e: "baz", id: number) => void)>()`,
      ["foo", "bar", "baz"],
    );
  });

  test("type literal call signatures stay compatible", async () => {
    await expectRuntimeEmits(
      `const emit = defineEmits<{ (e: "foo" | "bar"): void; (e: "baz", id: number): void }>()`,
      ["foo", "bar", "baz"],
    );
  });

  test("interface types stay compatible", async () => {
    await expectRuntimeEmits(
      `
interface Emits {
  (e: "foo" | "bar"): void
}

const emit = defineEmits<Emits>()
`,
      ["foo", "bar"],
    );
  });

  test("interface extends stays compatible", async () => {
    await expectRuntimeEmits(
      `
interface Base {
  (e: "foo"): void
}

interface Emits extends Base {
  (e: "bar"): void
}

const emit = defineEmits<Emits>()
`,
      ["foo", "bar"],
    );
  });

  test("exported interface stays compatible", async () => {
    await expectRuntimeEmits(
      `
export interface Emits {
  (e: "foo" | "bar"): void
}

const emit = defineEmits<Emits>()
`,
      ["foo", "bar"],
    );
  });

  test("types from normal script stay compatible", async () => {
    await expectRuntimeEmits(`const emit = defineEmits<Emits>()`, ["foo", "bar"], {
      script: `
export interface Emits {
  (e: "foo" | "bar"): void
}
`,
    });
  });

  test("type aliases stay compatible", async () => {
    await expectRuntimeEmits(
      `
type Emits = { (e: "foo" | "bar"): void }

const emit = defineEmits<Emits>()
`,
      ["foo", "bar"],
    );
  });

  test("referenced function types stay compatible", async () => {
    await expectRuntimeEmits(
      `
type Emits = (e: "foo" | "bar") => void

const emit = defineEmits<Emits>()
`,
      ["foo", "bar"],
    );
  });

  test("runtime args with annotated emit variable stay compatible", async () => {
    await expectRuntimeEmits(
      `
interface Emits {
  (e: "foo"): void
}

const emit: Emits = defineEmits(["foo"])
`,
      ["foo"],
    );
  });

  test("property syntax stays compatible", async () => {
    await expectRuntimeEmits(`const emit = defineEmits<{ foo: []; bar: [] }>()`, ["foo", "bar"]);
  });

  test("string-literal property syntax stays compatible", async () => {
    await expectRuntimeEmits(`const emit = defineEmits<{ "foo:bar": [] }>()`, ["foo:bar"]);
  });

  test("type references inside event-name unions stay compatible", async () => {
    await expectRuntimeEmits(
      `
type BaseEmit = "change"
type Emit = "some" | "emit" | BaseEmit

const emit = defineEmits<{
  (e: Emit): void
  (e: "another", value: string): void
}>()
`,
      ["some", "emit", "change", "another"],
    );
  });

  test("type and non-type arguments still throw Vue's compile error", async () => {
    const result = await resolveDefineEmitsCase({
      scriptSetup: `defineEmits<{ foo: [] }>({})`,
      compile: false,
    });

    expect(result.warnings).toEqual([]);
    expect(() => compileDefineEmitsCase(result)).toThrow(
      /cannot accept both type and non-type arguments/i,
    );
  });

  test("mixed property and call syntax still throw after plugin fallback", async () => {
    const result = await resolveDefineEmitsCase({
      scriptSetup: `
defineEmits<{
  foo: []
  (e: "hi"): void
}>()
`,
      compile: false,
    });

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(
      "defineEmits() type cannot mix call signature and property syntax",
    );
    expect(() => compileDefineEmitsCase(result)).toThrow(
      /mixed call signature and property syntax/i,
    );
  });
});
