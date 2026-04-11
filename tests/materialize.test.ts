import { describe, expect, test } from "vite-plus/test";

import { materializeRootProps } from "../src/materialize/materializeRootProps";
import { materializeValueType } from "../src/materialize/materializeValueType";
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

  test("prints readonly non-identifier keys as valid type literal members", () => {
    expect(
      printTypeLiteral([
        {
          key: "foo-bar",
          optional: false,
          readonly: true,
          type: { kind: "primitive", name: "string" },
        },
      ]),
    ).toBe('{\n  readonly "foo-bar": string\n}');
  });

  test("materializeValueType does not fabricate a literal without a value", () => {
    expect(materializeValueType({ kind: "literal" })).toEqual({
      kind: "reference",
      text: "unknown",
    });
  });

  test("prints readonly tuples with rest elements faithfully", () => {
    expect(
      printTypeLiteral([
        {
          key: "tupleProp",
          optional: false,
          readonly: false,
          type: {
            kind: "tuple",
            readonly: true,
            elements: [{ kind: "primitive", name: "string" }],
            rest: {
              kind: "array",
              element: { kind: "primitive", name: "number" },
            },
          },
        },
      ]),
    ).toBe("{\n  tupleProp: readonly [string, ...number[]]\n}");
  });

  test("wraps union array elements in parentheses", () => {
    expect(
      printTypeLiteral([
        {
          key: "values",
          optional: false,
          readonly: false,
          type: {
            kind: "array",
            element: {
              kind: "union",
              types: [
                { kind: "primitive", name: "string" },
                { kind: "primitive", name: "number" },
              ],
            },
          },
        },
      ]),
    ).toBe("{\n  values: (string | number)[]\n}");
  });
});
