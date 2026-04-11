import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vite-plus/test";

import { vueTypeResolver } from "../src";

test("public entry exports the plugin factory", () => {
  expect(typeof vueTypeResolver).toBe("function");
});

test("package metadata includes the tsgo runtime dependency", () => {
  const root = dirname(fileURLToPath(new URL("../package.json", import.meta.url)));
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
  };

  expect(packageJson.dependencies?.["@typescript/native-preview"]).toBeTruthy();
});
