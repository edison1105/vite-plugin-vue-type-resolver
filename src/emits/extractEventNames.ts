import { parse } from "@babel/parser";

export type ExtractEventNamesResult =
  | { ok: true; eventNames: string[] }
  | { ok: false; reason: string };

export type ExtractFiniteStringLiteralsResult =
  | { ok: true; eventNames: string[] }
  | { ok: false; reason: string };

interface LocalTypeAliasDeclaration {
  type: "TSTypeAliasDeclaration";
  id?: LocalIdentifier;
  typeAnnotation: LocalTypeNode;
}

interface LocalInterfaceBody {
  body: LocalTypeElement[];
}

interface LocalTSExpressionWithTypeArguments {
  expression: LocalIdentifier;
}

interface LocalInterfaceDeclaration {
  type: "TSInterfaceDeclaration";
  id: LocalIdentifier;
  body: LocalInterfaceBody;
  extends?: LocalTSExpressionWithTypeArguments[] | null;
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

interface LocalTSTypeReference {
  type: "TSTypeReference";
  typeName: LocalIdentifier;
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

interface LocalExportNamedDeclaration {
  type: "ExportNamedDeclaration";
  declaration?: LocalModuleDeclaration | null;
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
  | LocalTSTypeReference
  | { type: string };

type LocalModuleDeclaration =
  | LocalTypeAliasDeclaration
  | LocalInterfaceDeclaration
  | { type: string };

type ExtractionMode = "property" | "call";

interface ExtractionContext {
  aliases: Map<string, LocalTypeNode>;
  interfaces: Map<string, LocalInterfaceDeclaration>;
}

function isParenthesizedType(node: LocalTypeNode): node is LocalParenthesizedType {
  return node.type === "TSParenthesizedType";
}

function isLiteralType(node: LocalTypeNode): node is LocalLiteralType {
  return node.type === "TSLiteralType";
}

function isTypeReference(node: LocalTypeNode): node is LocalTSTypeReference {
  return node.type === "TSTypeReference";
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

function isTypeAliasDeclaration(node: unknown): node is LocalTypeAliasDeclaration {
  return (
    !!node &&
    typeof node === "object" &&
    (node as LocalTypeAliasDeclaration).type === "TSTypeAliasDeclaration"
  );
}

function isInterfaceDeclaration(node: unknown): node is LocalInterfaceDeclaration {
  return (
    !!node &&
    typeof node === "object" &&
    (node as LocalInterfaceDeclaration).type === "TSInterfaceDeclaration"
  );
}

function isExportNamedDeclaration(node: unknown): node is LocalExportNamedDeclaration {
  return (
    !!node &&
    typeof node === "object" &&
    (node as LocalExportNamedDeclaration).type === "ExportNamedDeclaration"
  );
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

function buildExtractionContext(sourceText: string): ExtractionContext {
  const ast = parse(sourceText, {
    sourceType: "module",
    plugins: ["typescript"],
  });
  const aliases = new Map<string, LocalTypeNode>();
  const interfaces = new Map<string, LocalInterfaceDeclaration>();

  for (const statement of ast.program.body) {
    let declaration: LocalModuleDeclaration | null = null;

    if (isTypeAliasDeclaration(statement) || isInterfaceDeclaration(statement)) {
      declaration = statement;
    } else if (isExportNamedDeclaration(statement) && statement.declaration) {
      declaration = statement.declaration;
    }

    if (!declaration) {
      continue;
    }

    if (isTypeAliasDeclaration(declaration) && declaration.id) {
      aliases.set(declaration.id.name, declaration.typeAnnotation);
      continue;
    }

    if (isInterfaceDeclaration(declaration)) {
      interfaces.set(declaration.id.name, declaration);
    }
  }

  return { aliases, interfaces };
}

function extractLiteralEventNames(
  typeNode: LocalTypeNode,
  context?: ExtractionContext,
  seenReferences: Set<string> = new Set(),
): ExtractEventNamesResult {
  if (isParenthesizedType(typeNode)) {
    return extractLiteralEventNames(typeNode.typeAnnotation, context, seenReferences);
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
      const result = extractLiteralEventNames(child, context, seenReferences);
      if (!result.ok) {
        return result;
      }

      for (const name of result.eventNames) {
        eventNames.add(name);
      }
    }

    return { ok: true, eventNames: [...eventNames].sort() };
  }

  if (isTypeReference(typeNode) && context) {
    const name = typeNode.typeName.name;
    if (seenReferences.has(name)) {
      return { ok: false, reason: "event names are not a finite string literal union" };
    }

    const target = context.aliases.get(name);
    if (!target) {
      return { ok: false, reason: "event names are not a finite string literal union" };
    }

    const nextSeen = new Set(seenReferences);
    nextSeen.add(name);
    return extractLiteralEventNames(target, context, nextSeen);
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

function extractCallEventNames(
  parameters: LocalFunctionParameter[],
  context?: ExtractionContext,
  seenReferences?: Set<string>,
): ExtractEventNamesResult {
  const firstParameter = parameters[0];

  if (
    !firstParameter?.typeAnnotation ||
    firstParameter.typeAnnotation.type !== "TSTypeAnnotation"
  ) {
    return { ok: false, reason: "event names are not a finite string literal union" };
  }

  return extractLiteralEventNames(
    firstParameter.typeAnnotation.typeAnnotation,
    context,
    seenReferences,
  );
}

function collectInterfaceEvents(
  declaration: LocalInterfaceDeclaration,
  context: ExtractionContext,
  eventNames: Set<string>,
  modes: Set<ExtractionMode>,
  seenReferences: Set<string>,
): ExtractEventNamesResult {
  for (const extended of declaration.extends ?? []) {
    const name = extended.expression.name;
    const target = context.interfaces.get(name) ?? context.aliases.get(name);

    if (!target) {
      return { ok: false, reason: "unsupported defineEmits root type" };
    }

    if (seenReferences.has(name)) {
      return { ok: false, reason: "unsupported defineEmits root type" };
    }

    const nextSeen = new Set(seenReferences);
    nextSeen.add(name);

    const result = isInterfaceDeclaration(target)
      ? collectInterfaceEvents(target, context, eventNames, modes, nextSeen)
      : collectTypeNodeEvents(target, context, eventNames, modes, nextSeen);
    if (!result.ok) {
      return result;
    }
  }

  return collectTypeNodeEvents(
    {
      type: "TSTypeLiteral",
      members: declaration.body.body,
    },
    context,
    eventNames,
    modes,
    seenReferences,
  );
}

function collectTypeNodeEvents(
  typeNode: LocalTypeNode,
  context: ExtractionContext | undefined,
  eventNames: Set<string>,
  modes: Set<ExtractionMode>,
  seenReferences: Set<string> = new Set(),
): ExtractEventNamesResult {
  if (isParenthesizedType(typeNode)) {
    return collectTypeNodeEvents(
      typeNode.typeAnnotation,
      context,
      eventNames,
      modes,
      seenReferences,
    );
  }

  if (isFunctionType(typeNode)) {
    modes.add("call");
    const result = extractCallEventNames(typeNode.parameters, context, seenReferences);
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
        const result = extractCallEventNames(member.parameters, context, seenReferences);
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
      const result = collectTypeNodeEvents(child, context, eventNames, modes, seenReferences);
      if (!result.ok) {
        return result;
      }
    }

    return { ok: true, eventNames: [] };
  }

  if (isTypeReference(typeNode) && context) {
    const name = typeNode.typeName.name;
    if (seenReferences.has(name)) {
      return { ok: false, reason: "unsupported defineEmits root type" };
    }

    const interfaceDeclaration = context.interfaces.get(name);
    if (interfaceDeclaration) {
      const nextSeen = new Set(seenReferences);
      nextSeen.add(name);
      return collectInterfaceEvents(interfaceDeclaration, context, eventNames, modes, nextSeen);
    }

    const alias = context.aliases.get(name);
    if (!alias) {
      return { ok: false, reason: "unsupported defineEmits root type" };
    }

    const nextSeen = new Set(seenReferences);
    nextSeen.add(name);
    return collectTypeNodeEvents(alias, context, eventNames, modes, nextSeen);
  }

  return { ok: false, reason: "unsupported defineEmits root type" };
}

export function extractEventNamesFromTypeText(typeText: string): ExtractEventNamesResult {
  return extractEventNamesFromAnalysisSource(`type __VTR_Emits = ${typeText}`, "__VTR_Emits");
}

export function extractEventNamesFromAnalysisSource(
  sourceText: string,
  targetName: string,
): ExtractEventNamesResult {
  try {
    const context = buildExtractionContext(sourceText);
    const target = context.aliases.get(targetName);
    if (!target) {
      return { ok: false, reason: "unsupported defineEmits root type" };
    }

    const eventNames = new Set<string>();
    const modes = new Set<ExtractionMode>();
    const result = collectTypeNodeEvents(target, context, eventNames, modes);

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
