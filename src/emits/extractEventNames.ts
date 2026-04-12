import { parse } from "@babel/parser";

export type ExtractEventNamesResult =
  | { ok: true; eventNames: string[] }
  | { ok: false; reason: string };

export type ExtractFiniteStringLiteralsResult =
  | { ok: true; eventNames: string[] }
  | { ok: false; reason: string };

interface LocalTypeAliasDeclaration {
  type: "TSTypeAliasDeclaration";
  typeAnnotation: LocalTypeNode;
}

interface LocalTypeLiteral {
  type: "TSTypeLiteral";
  members: LocalTypeElement[];
}

interface LocalFunctionType {
  type: "TSFunctionType";
  parameters: LocalFunctionParameter[];
}

interface LocalPropertySignature {
  type: "TSPropertySignature";
  key: LocalPropertyKey;
}

interface LocalMethodSignature {
  type: "TSMethodSignature";
  key: LocalPropertyKey;
}

interface LocalCallSignatureDeclaration {
  type: "TSCallSignatureDeclaration";
  parameters: LocalFunctionParameter[];
}

interface LocalIntersectionType {
  type: "TSIntersectionType";
  types: LocalTypeNode[];
}

interface LocalUnionType {
  type: "TSUnionType";
  types: LocalTypeNode[];
}

interface LocalParenthesizedType {
  type: "TSParenthesizedType";
  typeAnnotation: LocalTypeNode;
}

interface LocalLiteralType {
  type: "TSLiteralType";
  literal: LocalPropertyKey;
}

interface LocalIdentifier {
  type: "Identifier";
  name: string;
}

interface LocalStringLiteral {
  type: "StringLiteral";
  value: string;
}

interface LocalNumericLiteral {
  type: "NumericLiteral";
  value: number;
}

interface LocalTemplateLiteral {
  type: "TemplateLiteral";
  expressions: unknown[];
  quasis: Array<{
    value: {
      cooked: string | null;
    };
  }>;
}

interface LocalTypeAnnotation {
  type: "TSTypeAnnotation";
  typeAnnotation: LocalTypeNode;
}

interface LocalParameter {
  type: "Identifier";
  typeAnnotation?: LocalTypeAnnotation | null;
}

type LocalFunctionParameter = LocalParameter;

type LocalPropertyKey =
  | LocalIdentifier
  | LocalStringLiteral
  | LocalNumericLiteral
  | LocalTemplateLiteral;

type LocalTypeElement =
  | LocalPropertySignature
  | LocalMethodSignature
  | LocalCallSignatureDeclaration
  | { type: string };

type LocalTypeNode =
  | LocalTypeLiteral
  | LocalFunctionType
  | LocalIntersectionType
  | LocalUnionType
  | LocalParenthesizedType
  | LocalLiteralType
  | { type: string };

type ExtractionMode = "property" | "call";

function isParenthesizedType(node: LocalTypeNode): node is LocalParenthesizedType {
  return node.type === "TSParenthesizedType";
}

function isLiteralType(node: LocalTypeNode): node is LocalLiteralType {
  return node.type === "TSLiteralType";
}

function isUnionType(node: LocalTypeNode): node is LocalUnionType {
  return node.type === "TSUnionType";
}

function isIntersectionType(node: LocalTypeNode): node is LocalIntersectionType {
  return node.type === "TSIntersectionType";
}

function isFunctionType(node: LocalTypeNode): node is LocalFunctionType {
  return node.type === "TSFunctionType";
}

function isTypeLiteral(node: LocalTypeNode): node is LocalTypeLiteral {
  return node.type === "TSTypeLiteral";
}

function isPropertyLikeMember(
  member: LocalTypeElement,
): member is LocalPropertySignature | LocalMethodSignature {
  return member.type === "TSPropertySignature" || member.type === "TSMethodSignature";
}

function isCallSignatureMember(member: LocalTypeElement): member is LocalCallSignatureDeclaration {
  return member.type === "TSCallSignatureDeclaration";
}

function readPropertyKey(key: LocalPropertyKey): string | null {
  if (key.type === "Identifier") {
    return key.name;
  }

  if (key.type === "StringLiteral") {
    return key.value;
  }

  if (key.type === "NumericLiteral") {
    return String(key.value);
  }

  if (key.type === "TemplateLiteral" && key.expressions.length === 0) {
    return key.quasis[0]?.value.cooked ?? null;
  }

  return null;
}

function extractLiteralEventNames(typeNode: LocalTypeNode): ExtractEventNamesResult {
  if (isParenthesizedType(typeNode)) {
    return extractLiteralEventNames(typeNode.typeAnnotation);
  }

  if (isLiteralType(typeNode)) {
    const name = readPropertyKey(typeNode.literal);
    return name === null
      ? { ok: false, reason: "event names are not a finite string literal union" }
      : { ok: true, eventNames: [name] };
  }

  if (isUnionType(typeNode)) {
    const eventNames = new Set<string>();

    for (const child of typeNode.types) {
      const result = extractLiteralEventNames(child);
      if (!result.ok) {
        return result;
      }

      for (const name of result.eventNames) {
        eventNames.add(name);
      }
    }

    return { ok: true, eventNames: [...eventNames].sort() };
  }

  return { ok: false, reason: "event names are not a finite string literal union" };
}

export function extractFiniteStringLiteralsFromTypeText(
  typeText: string,
): ExtractFiniteStringLiteralsResult {
  try {
    const ast = parse(`type __VTR_EventName = ${typeText}`, {
      sourceType: "module",
      plugins: ["typescript"],
    });

    const declaration = ast.program.body[0];
    if (!declaration || declaration.type !== "TSTypeAliasDeclaration") {
      return { ok: false, reason: "event names are not a finite string literal union" };
    }

    return extractLiteralEventNames((declaration as LocalTypeAliasDeclaration).typeAnnotation);
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function extractCallEventNames(parameters: LocalFunctionParameter[]): ExtractEventNamesResult {
  const firstParameter = parameters[0];

  if (
    !firstParameter?.typeAnnotation ||
    firstParameter.typeAnnotation.type !== "TSTypeAnnotation"
  ) {
    return { ok: false, reason: "event names are not a finite string literal union" };
  }

  return extractLiteralEventNames(firstParameter.typeAnnotation.typeAnnotation);
}

function collectTypeNodeEvents(
  typeNode: LocalTypeNode,
  eventNames: Set<string>,
  modes: Set<ExtractionMode>,
): ExtractEventNamesResult {
  if (isParenthesizedType(typeNode)) {
    return collectTypeNodeEvents(typeNode.typeAnnotation, eventNames, modes);
  }

  if (isFunctionType(typeNode)) {
    modes.add("call");
    const result = extractCallEventNames(typeNode.parameters);
    if (!result.ok) {
      return result;
    }

    for (const name of result.eventNames) {
      eventNames.add(name);
    }

    return { ok: true, eventNames: [] };
  }

  if (isTypeLiteral(typeNode)) {
    for (const member of typeNode.members) {
      if (isPropertyLikeMember(member)) {
        modes.add("property");
        const name = readPropertyKey(member.key);
        if (name === null) {
          return { ok: false, reason: "event names are not a finite string literal union" };
        }
        eventNames.add(name);
        continue;
      }

      if (isCallSignatureMember(member)) {
        modes.add("call");
        const result = extractCallEventNames(member.parameters);
        if (!result.ok) {
          return result;
        }

        for (const name of result.eventNames) {
          eventNames.add(name);
        }
      }
    }

    return { ok: true, eventNames: [] };
  }

  if (isIntersectionType(typeNode) || isUnionType(typeNode)) {
    for (const child of typeNode.types) {
      const result = collectTypeNodeEvents(child, eventNames, modes);
      if (!result.ok) {
        return result;
      }
    }

    return { ok: true, eventNames: [] };
  }

  return { ok: false, reason: "unsupported defineEmits root type" };
}

export function extractEventNamesFromTypeText(typeText: string): ExtractEventNamesResult {
  try {
    const ast = parse(`type __VTR_Emits = ${typeText}`, {
      sourceType: "module",
      plugins: ["typescript"],
    });

    const declaration = ast.program.body[0];
    if (!declaration || declaration.type !== "TSTypeAliasDeclaration") {
      return { ok: false, reason: "unsupported defineEmits root type" };
    }

    const eventNames = new Set<string>();
    const modes = new Set<ExtractionMode>();
    const result = collectTypeNodeEvents(
      (declaration as LocalTypeAliasDeclaration).typeAnnotation,
      eventNames,
      modes,
    );

    if (!result.ok) {
      return result;
    }

    if (modes.has("property") && modes.has("call")) {
      return {
        ok: false,
        reason: "defineEmits() type cannot mix call signature and property syntax",
      };
    }

    if (eventNames.size === 0) {
      return { ok: false, reason: "unsupported defineEmits root type" };
    }

    return {
      ok: true,
      eventNames: [...eventNames].sort(),
    };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
