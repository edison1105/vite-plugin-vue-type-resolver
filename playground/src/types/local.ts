export interface LocalCardShape {
  title: string;
  pinned: boolean;
  count: number;
  archivedAt: Date;
}

export interface ThirdPartyShape {
  label: string;
  size: number;
  active: boolean;
  metadata: Map<string, string>;
}
