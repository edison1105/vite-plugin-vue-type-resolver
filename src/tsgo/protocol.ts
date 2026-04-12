export interface ApiRequest<TParams = unknown> {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: TParams;
}

export interface ApiResponse<TResult = unknown> {
  jsonrpc: "2.0";
  id: number;
  result?: TResult;
  error?: {
    code: number;
    message: string;
  };
}

export interface DocumentIdentifier {
  fileName?: string;
  uri?: string;
}

export interface ProjectResponse {
  id: string;
  configFileName: string;
}

export interface UpdateSnapshotResponse {
  snapshot: string;
  projects: ProjectResponse[];
}

export interface DiagnosticResponse {
  fileName?: string;
  pos: number;
  end: number;
  code: number;
  category: number;
  text: string;
}

export interface AccessibleEntriesResponse {
  files: string[];
  directories: string[];
}

export interface ReadFileResponse {
  content: string | null;
}

export interface TsgoSymbolResponse {
  id: string;
  name: string;
  flags: number;
  checkFlags?: number;
  declarations?: string[];
  valueDeclaration?: string;
}

export interface TsgoTypeResponse {
  id: string;
  flags?: number;
  objectFlags?: number;
  symbol?: TsgoSymbolResponse | null;
  target?: TsgoTypeResponse | null;
  value?: string | number | boolean | null;
}

export interface TsgoIndexInfoResponse {
  keyType: TsgoTypeResponse;
  valueType: TsgoTypeResponse;
  isReadonly: boolean;
}

export interface TsgoSignatureResponse {
  id: string;
  flags: number;
  declaration?: string;
  parameters: string[];
}

type Awaitable<T> = T | Promise<T>;

export interface VirtualFileSystemCallbacks {
  readFile?(path: string): Awaitable<ReadFileResponse | null>;
  fileExists?(path: string): Awaitable<boolean | null>;
  directoryExists?(path: string): Awaitable<boolean | null>;
  getAccessibleEntries?(path: string): Awaitable<AccessibleEntriesResponse | null>;
  realpath?(path: string): Awaitable<string | null>;
}
