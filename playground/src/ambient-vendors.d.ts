declare module "element-plus" {
  export const ElTable: abstract new (...args: any[]) => {
    clearSelection(): void;
  };

  export const ElTableColumn: abstract new (...args: any[]) => {
    label?: string;
    prop?: string;
    width?: string | number;
  };
}
