declare global {
  interface AmbientPalette {
    tone: "warm" | "cool";
    version: number;
    pinned: boolean;
    createdAt: Date;
  }

  type GlobalAmbientProps = Readonly<
    Pick<AmbientPalette, "tone"> &
      Partial<Pick<AmbientPalette, "version">> & {
        pinned?: AmbientPalette["pinned"];
      }
  >;
}

export {};
