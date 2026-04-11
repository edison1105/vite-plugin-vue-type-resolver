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
      if (input.value === undefined) {
        return { kind: "reference", text: "unknown" };
      }

      return { kind: "literal", value: input.value };
    default:
      return { kind: "reference", text: input.typeName ?? "unknown" };
  }
}
