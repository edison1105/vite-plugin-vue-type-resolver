export interface VueTypeResolverFilterContext {
  id: string;
  code: string;
}

export type VueTypeResolverFilter = (context: VueTypeResolverFilterContext) => boolean;

export interface VueTypeResolverOptions {
  tsconfigPath?: string;
  logSnapshotStats?: boolean;
  filter?: VueTypeResolverFilter;
}

export interface NormalizedVueTypeResolverOptions {
  tsconfigPath?: string;
  logSnapshotStats: boolean;
  filter?: VueTypeResolverFilter;
}

export function normalizeOptions(
  options: VueTypeResolverOptions = {},
): NormalizedVueTypeResolverOptions {
  return {
    tsconfigPath: options.tsconfigPath,
    logSnapshotStats: options.logSnapshotStats ?? false,
    filter: options.filter,
  };
}
