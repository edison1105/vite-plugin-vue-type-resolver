import type { Plugin } from "vite-plus";

type HookLike<T extends (...args: never[]) => unknown> = T | { handler: T };

function getHookHandler<T extends (...args: never[]) => unknown>(
  hook: HookLike<T> | null | undefined,
): T | undefined {
  if (typeof hook === "function") {
    return hook;
  }

  if (hook && typeof hook === "object" && "handler" in hook && typeof hook.handler === "function") {
    return hook.handler;
  }

  return undefined;
}

export async function runPluginTransform(input: {
  plugin: Plugin;
  code: string;
  id: string;
  cwd?: string;
}) {
  const warnings: string[] = [];
  const originalCwd = process.cwd();
  const buildStart = getHookHandler(input.plugin.buildStart);
  const transform = getHookHandler(input.plugin.transform);
  const buildEnd = getHookHandler(input.plugin.buildEnd);

  if (input.cwd) {
    process.chdir(input.cwd);
  }

  try {
    if (buildStart) {
      await buildStart.apply({} as never, [{}] as Parameters<typeof buildStart>);
    }

    const result = transform
      ? await transform.apply(
          {
            warn(message: string) {
              warnings.push(message);
            },
          } as never,
          [input.code, input.id],
        )
      : undefined;

    return {
      result,
      warnings,
    };
  } finally {
    if (buildEnd) {
      await buildEnd.apply({} as never, []);
    }

    if (input.cwd) {
      process.chdir(originalCwd);
    }
  }
}
