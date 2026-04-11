import { spawn, type ChildProcess } from "node:child_process";

import {
  createMessageConnection,
  RequestType,
  StreamMessageReader,
  StreamMessageWriter,
  type MessageConnection,
} from "vscode-jsonrpc/node";

import type { VirtualFileSystemCallbacks } from "./protocol";

const CALLBACK_METHODS = [
  "readFile",
  "fileExists",
  "directoryExists",
  "getAccessibleEntries",
  "realpath",
] as const;

export class TsgoClient {
  private process?: ChildProcess;
  private connection?: MessageConnection;
  private connectPromise?: Promise<void>;
  private processExitPromise?: Promise<Error | null>;
  private closing = false;
  private lastProcessError?: Error;

  constructor(
    private readonly options: {
      cwd: string;
      tsgoPath: string;
      callbacks?: VirtualFileSystemCallbacks;
    },
  ) {}

  async connect(): Promise<void> {
    if (this.connection) {
      return;
    }

    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = this.start();

    try {
      await this.connectPromise;
    } finally {
      this.connectPromise = undefined;
    }
  }

  async request<TResult>(method: string, params?: unknown): Promise<TResult> {
    await this.connect();

    if (!this.connection) {
      throw new Error("tsgo connection not established");
    }

    const request = this.connection.sendRequest(
      new RequestType<unknown, TResult, void>(method),
      params,
    );

    try {
      if (!this.processExitPromise) {
        return await request;
      }

      const winner = await Promise.race([
        request.then((result) => ({ kind: "request" as const, result })),
        this.processExitPromise.then((error) => ({ kind: "exit" as const, error })),
      ]);

      if (winner.kind === "exit") {
        if (winner.error) {
          throw winner.error;
        }

        return await request;
      }

      return winner.result;
    } catch (error) {
      if (this.lastProcessError) {
        throw this.lastProcessError;
      }

      throw error;
    }
  }

  async close(): Promise<void> {
    this.closing = true;

    const connection = this.connection;
    const process = this.process;
    const exitPromise = this.processExitPromise;

    process?.stdin?.end();

    if (process && !(await this.waitForProcessExit(exitPromise, 1_000))) {
      process.kill();
      await this.waitForProcessExit(exitPromise, 1_000);
    }

    connection?.dispose();
    this.connection = undefined;
    this.process = undefined;
    this.processExitPromise = undefined;
    this.lastProcessError = undefined;
    this.closing = false;
  }

  private async start(): Promise<void> {
    const args = ["--api", "--async", "--cwd", this.options.cwd];
    const callbacks = this.getEnabledCallbacks();
    if (callbacks.length > 0) {
      args.push("--callbacks", callbacks.join(","));
    }

    this.lastProcessError = undefined;
    const process = spawn(this.options.tsgoPath, args, { stdio: ["pipe", "pipe", "inherit"] });
    this.process = process;
    this.processExitPromise = this.createProcessExitPromise(process);

    if (!process.stdout || !process.stdin) {
      throw new Error("tsgo process stdio was not initialized");
    }

    this.connection = createMessageConnection(
      new StreamMessageReader(process.stdout),
      new StreamMessageWriter(process.stdin),
    );

    this.registerCallbacks();
    this.connection.listen();
  }

  private getEnabledCallbacks(): string[] {
    const callbacks = this.options.callbacks;
    if (!callbacks) {
      return [];
    }

    return CALLBACK_METHODS.filter((method) => callbacks[method] !== undefined);
  }

  private registerCallbacks(): void {
    if (!this.connection || !this.options.callbacks) {
      return;
    }

    for (const method of CALLBACK_METHODS) {
      const handler = this.options.callbacks[method];
      if (!handler) {
        continue;
      }

      this.connection.onRequest(method, (path: string) => handler(path) ?? null);
    }
  }

  private createProcessExitPromise(process: ChildProcess): Promise<Error | null> {
    return new Promise((resolve) => {
      let settled = false;

      const settle = (error: Error | null) => {
        if (settled) {
          return;
        }

        settled = true;
        process.removeListener("error", onError);
        process.removeListener("exit", onExit);

        if (this.process === process) {
          this.process = undefined;
        }

        if (this.connection) {
          this.connection.dispose();
          this.connection = undefined;
        }

        if (this.processExitPromise) {
          this.processExitPromise = undefined;
        }

        if (error) {
          this.lastProcessError = error;
        }

        resolve(error);
      };

      const onError = (error: Error) => {
        settle(
          new Error(`tsgo process error while running in ${this.options.cwd}: ${error.message}`, {
            cause: error,
          }),
        );
      };

      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        if (this.closing && (code === 0 || signal !== null)) {
          settle(null);
          return;
        }

        settle(
          new Error(
            `tsgo process exited unexpectedly (code ${code ?? "null"}, signal ${signal ?? "null"})`,
          ),
        );
      };

      process.once("error", onError);
      process.once("exit", onExit);
    });
  }

  private async waitForProcessExit(
    exitPromise: Promise<Error | null> | undefined,
    timeoutMs: number,
  ): Promise<boolean> {
    if (!exitPromise) {
      return true;
    }

    await Promise.race([
      exitPromise,
      new Promise<undefined>((resolve) => {
        setTimeout(() => resolve(undefined), timeoutMs);
      }),
    ]);
    return this.process === undefined;
  }
}
