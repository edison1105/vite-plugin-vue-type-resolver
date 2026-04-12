function isIdentifierName(name: string): boolean {
  return /^[$A-Z_a-z][$\w]*$/.test(name);
}

function printEmitsKey(name: string): string {
  return isIdentifierName(name) ? name : JSON.stringify(name);
}

export function printEmitsTypeLiteral(eventNames: string[]): string {
  if (eventNames.length === 0) {
    return "{}";
  }

  return `{\n${eventNames.map((name) => `  ${printEmitsKey(name)}: any[]`).join("\n")}\n}`;
}
