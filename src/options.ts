export interface VueTypeResolverOptions {
  tsconfigPath?: string;
  logSnapshotStats?: boolean;
}

export interface NormalizedVueTypeResolverOptions {
  tsconfigPath?: string;
  logSnapshotStats: boolean;
}

export function normalizeOptions(
  options: VueTypeResolverOptions = {},
): NormalizedVueTypeResolverOptions {
  return {
    tsconfigPath: options.tsconfigPath,
    logSnapshotStats: options.logSnapshotStats ?? false,
  };
}
