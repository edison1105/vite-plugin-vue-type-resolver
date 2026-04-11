export interface BuildAnalysisModuleInput {
  imports: string[];
  localDeclarations: string[];
  targetTypeText: string;
  targetName: string;
}

export function buildAnalysisModule(input: BuildAnalysisModuleInput): string {
  return [
    ...input.imports,
    ...input.localDeclarations,
    `type ${input.targetName} = ${input.targetTypeText}`,
    "",
  ].join("\n");
}
