import type { PluginOption } from "vite-plus";

import { vueTypeResolver } from "../src";

const pluginOption: PluginOption = vueTypeResolver();

void pluginOption;
