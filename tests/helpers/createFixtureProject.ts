import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface FixtureProject {
  root: string;
  write(path: string, content: string): void;
}

export function createFixtureProject(files: Record<string, string>): FixtureProject {
  const root = mkdtempSync(join(tmpdir(), "vtr-"));

  const write = (relativePath: string, content: string) => {
    const absolutePath = join(root, relativePath);
    mkdirSync(dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content);
  };

  for (const [path, content] of Object.entries(files)) {
    write(path, content);
  }

  return { root, write };
}
