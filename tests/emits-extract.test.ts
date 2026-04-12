import { describe, expect, test } from "vite-plus/test";

import { extractEventNamesFromTypeText } from "../src/emits/extractEventNames";

describe("extractEventNamesFromTypeText", () => {
  test("extracts event names from property syntax", () => {
    const result = extractEventNamesFromTypeText(`{
  change: any[]
  "update:modelValue": any[]
}`);

    expect(result).toEqual({
      ok: true,
      eventNames: ["change", "update:modelValue"],
    });
  });

  test("extracts event names from call signatures", () => {
    const result = extractEventNamesFromTypeText(`{
  (e: "change", value: number): void
  (e: "submit"): void
}`);

    expect(result).toEqual({
      ok: true,
      eventNames: ["change", "submit"],
    });
  });

  test("extracts event names from intersection signatures", () => {
    const result = extractEventNamesFromTypeText(
      `((e: "change", value: number) => void) & ((e: "submit") => void)`,
    );

    expect(result).toEqual({
      ok: true,
      eventNames: ["change", "submit"],
    });
  });

  test("fails on wide string event names", () => {
    const result = extractEventNamesFromTypeText(`(e: string, value: number) => void`);

    expect(result).toEqual({
      ok: false,
      reason: "event names are not a finite string literal union",
    });
  });

  test("fails on mixed property and call signature syntax", () => {
    const result = extractEventNamesFromTypeText(`{
  change: any[]
  (e: "submit"): void
}`);

    expect(result).toEqual({
      ok: false,
      reason: "defineEmits() type cannot mix call signature and property syntax",
    });
  });
});
