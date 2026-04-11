import type { MaterializedProp, MaterializedType } from "./types";

function needsArrayElementParens(type: MaterializedType): boolean {
  return type.kind === "union" || type.kind === "intersection" || type.kind === "function";
}

function printType(type: MaterializedType): string {
  switch (type.kind) {
    case "primitive":
      return type.name;
    case "literal":
      return typeof type.value === "string" ? JSON.stringify(type.value) : String(type.value);
    case "array":
      return `${needsArrayElementParens(type.element) ? `(${printType(type.element)})` : printType(type.element)}[]`;
    case "reference":
      return type.text;
    case "function":
      return "(...args: any[]) => any";
    case "tuple":
      return `${type.readonly ? "readonly " : ""}[${[
        ...type.elements.map(printType),
        ...(type.rest ? [`...${printType(type.rest)}`] : []),
      ].join(", ")}]`;
    case "union":
      return type.types.map(printType).join(" | ");
    case "intersection":
      return type.types.map(printType).join(" & ");
    case "object":
      return printTypeLiteral(type.props);
  }
}

function printPropertyKey(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
}

export function printTypeLiteral(props: MaterializedProp[]): string {
  const lines = props.map((prop) => {
    const optional = prop.optional ? "?" : "";
    const readonly = prop.readonly ? "readonly " : "";
    return `  ${readonly}${printPropertyKey(prop.key)}${optional}: ${printType(prop.type)}`;
  });

  return `{\n${lines.join("\n")}\n}`;
}
