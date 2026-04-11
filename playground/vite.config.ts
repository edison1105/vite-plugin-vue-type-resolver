import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite-plus";

import { vueTypeResolver } from "../dist/index.mjs";

export default defineConfig({
  plugins: [vueTypeResolver(), vue()],
  fmt: {},
  lint: { options: { typeAware: true, typeCheck: true } },
});
