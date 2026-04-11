import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);

export function getTsgoBinary(): string {
  const packageJson = require.resolve("@typescript/native-preview/package.json");
  const packageDir = dirname(packageJson);
  const getExePathModule = join(packageDir, "lib", "getExePath.js");
  const { default: getExePath } = require(getExePathModule) as {
    default: () => string;
  };

  return getExePath();
}
