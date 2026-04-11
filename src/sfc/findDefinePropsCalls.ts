import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import type { NodePath } from "@babel/traverse";

import type { ParsedSfc } from "./parseSfc";

export interface DefinePropsCallSite {
  block: "script" | "scriptSetup";
  callStart: number;
  callEnd: number;
  typeArgStart: number;
  typeArgEnd: number;
  typeText: string;
}

interface LocalIdentifier {
  type: "Identifier";
  name: string;
}

interface LocalTypeParameterInstantiation {
  params: Array<{
    start: number | null | undefined;
    end: number | null | undefined;
  }>;
}

interface LocalCallExpression {
  callee: unknown;
  start: number | null | undefined;
  end: number | null | undefined;
  typeParameters?: LocalTypeParameterInstantiation | null;
}

const traverse = (
  typeof traverseModule === "function"
    ? traverseModule
    : (traverseModule as unknown as { default: typeof traverseModule }).default
) as typeof traverseModule;

function isDefinePropsIdentifier(node: unknown): node is LocalIdentifier {
  return (
    !!node &&
    typeof node === "object" &&
    (node as LocalIdentifier).type === "Identifier" &&
    (node as LocalIdentifier).name === "defineProps"
  );
}

function hasTypeArgument(
  typeParameters: LocalTypeParameterInstantiation | undefined | null,
): typeParameters is LocalTypeParameterInstantiation {
  return !!typeParameters && typeParameters.params.length === 1;
}

export function findDefinePropsCalls(sfc: ParsedSfc): DefinePropsCallSite[] {
  const calls: DefinePropsCallSite[] = [];

  for (const [blockName, block] of [
    ["script", sfc.script] as const,
    ["scriptSetup", sfc.scriptSetup] as const,
  ]) {
    if (!block || block.attrs.lang !== "ts") continue;

    const ast = parse(block.content, {
      sourceType: "module",
      plugins: ["typescript"],
    });

    traverse(ast, {
      CallExpression(path: NodePath) {
        const node = path.node as LocalCallExpression;

        if (!isDefinePropsIdentifier(node.callee)) return;
        if (path.scope.getBinding("defineProps")) return;
        if (!hasTypeArgument(node.typeParameters)) return;

        const typeNode = node.typeParameters.params[0];
        if (
          node.start == null ||
          node.end == null ||
          typeNode.start == null ||
          typeNode.end == null
        ) {
          return;
        }

        calls.push({
          block: blockName,
          callStart: block.locStart + node.start,
          callEnd: block.locStart + node.end,
          typeArgStart: block.locStart + typeNode.start,
          typeArgEnd: block.locStart + typeNode.end,
          typeText: block.content.slice(typeNode.start, typeNode.end),
        });
      },
    });
  }

  return calls;
}
