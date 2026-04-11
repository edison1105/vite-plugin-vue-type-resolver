import { materializeValueType } from "./materializeValueType";
import type { MaterializeResult, MaterializedProp, MaterializedType } from "./types";

interface InputPropDescription {
  name: string;
  optional: boolean;
  readonly: boolean;
  unsupportedKey?: boolean;
  kind: string;
  typeName?: string;
  value?: string | number | boolean;
  properties?: InputPropDescription[];
}

function normalizeOptionalType(input: InputPropDescription): InputPropDescription {
  if (!input.optional || !input.typeName) {
    return input;
  }

  const parts = input.typeName
    .split("|")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "undefined");

  if (parts.length === 0) {
    return input;
  }

  if (parts.every((part) => part === "true" || part === "false")) {
    return {
      ...input,
      kind: "primitive",
      typeName: "boolean",
      value: undefined,
    };
  }

  if (parts.length === 1) {
    return {
      ...input,
      kind:
        parts[0] === "string" || parts[0] === "number" || parts[0] === "boolean"
          ? "primitive"
          : input.kind,
      typeName: parts[0],
      value: undefined,
    };
  }

  return {
    ...input,
    kind: "reference",
    typeName: parts.join(" | "),
    value: undefined,
  };
}

function materializePropType(input: InputPropDescription): MaterializedType | null {
  const normalized = normalizeOptionalType(input);

  if (normalized.kind === "object") {
    const props = normalized.properties?.map(materializeProperty);
    if (!props || props.some((prop) => prop === null)) {
      return null;
    }

    return {
      kind: "object",
      props: props.filter((prop): prop is MaterializedProp => prop !== null),
    };
  }

  return materializeValueType(normalized);
}

function materializeProperty(input: InputPropDescription): MaterializedProp | null {
  if (input.unsupportedKey) {
    return null;
  }

  const type = materializePropType(input);
  if (!type) {
    return null;
  }

  return {
    key: input.name,
    optional: input.optional,
    readonly: input.readonly,
    type,
  };
}

export async function materializeRootProps(input: {
  type: {
    properties: InputPropDescription[];
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

  const props = input.type.properties.map(materializeProperty);
  if (props.some((prop) => prop === null)) {
    return {
      ok: false,
      reason: "unsupported-key",
      warnings: [],
    };
  }

  return {
    ok: true,
    props: props.filter((prop): prop is MaterializedProp => prop !== null),
    warnings: [],
  };
}
