import { expect, test } from "vite-plus/test";

import { vueTypeResolver } from "../src";

test("public entry exports the plugin factory", () => {
  expect(typeof vueTypeResolver).toBe("function");
});
