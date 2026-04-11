import { expect, test } from "vite-plus/test";

import { vueTypeResolver } from "../src";

test("exports a named Vite plugin factory", () => {
  const plugin = vueTypeResolver();

  expect(plugin.name).toBe("vite-plugin-vue-type-resolver");
  expect(plugin.enforce).toBe("pre");
  expect(typeof plugin.transform).toBe("function");
});
