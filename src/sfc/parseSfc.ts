import { parse } from "@vue/compiler-sfc";

export interface ParsedSfcBlock {
  content: string;
  attrs: Record<string, string | true>;
  locStart: number;
}

export interface ParsedSfc {
  filename: string;
  source: string;
  script?: ParsedSfcBlock;
  scriptSetup?: ParsedSfcBlock;
}

function toBlock(
  block:
    | {
        content: string;
        attrs: Record<string, string | true>;
        loc: { start: { offset: number } };
      }
    | null
    | undefined,
): ParsedSfcBlock | undefined {
  if (!block) return undefined;

  return {
    content: block.content,
    attrs: block.attrs,
    locStart: block.loc.start.offset,
  };
}

export function parseSfc(filename: string, source: string): ParsedSfc {
  const { descriptor } = parse(source, { filename });

  return {
    filename,
    source,
    script: toBlock(descriptor.script),
    scriptSetup: toBlock(descriptor.scriptSetup),
  };
}
