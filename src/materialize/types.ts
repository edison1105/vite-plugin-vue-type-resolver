export type MaterializedType =
  | { kind: "primitive"; name: string }
  | { kind: "literal"; value: string | number | boolean }
  | { kind: "array"; element: MaterializedType }
  | { kind: "tuple"; elements: MaterializedType[]; rest?: MaterializedType; readonly: boolean }
  | { kind: "union"; types: MaterializedType[] }
  | { kind: "intersection"; types: MaterializedType[] }
  | { kind: "function" }
  | { kind: "object"; props: MaterializedProp[] }
  | { kind: "reference"; text: string };

export interface MaterializedProp {
  key: string;
  optional: boolean;
  readonly: boolean;
  type: MaterializedType;
}

export type FallbackReason =
  | "open-index-signature"
  | "non-object-root"
  | "unresolved-property-type"
  | "recursive-limit"
  | "unsupported-key";

export type MaterializeResult =
  | { ok: true; props: MaterializedProp[]; warnings: string[] }
  | { ok: false; reason: FallbackReason; warnings: string[] };
