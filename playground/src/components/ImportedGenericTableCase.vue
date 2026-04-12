<script setup lang="ts">
type BucketData = {
  id: string;
  name: string;
  is_enabled: boolean;
  max_objects: number;
  max_size: number;
  owner: string;
  placement: string;
  used: string;
  objects: number;
  used_percent: number;
  used_bytes: number;
};

type TableFieldKey<T, S extends string | undefined> = S extends undefined
  ? keyof T
  : keyof (T & Record<Extract<S, string>, string>);

type TableColumnKey<T, S extends string | undefined> = TableFieldKey<T, S> | "operation";

type CoveredColumnAttribute = "formatter" | "type" | "align" | "headerAlign" | "filterPlacement";
type ElTableColumnCtor = typeof import("element-plus").ElTableColumn;

type TableColumn<T, S extends string | undefined = undefined> = Partial<
  Omit<InstanceType<ElTableColumnCtor>, CoveredColumnAttribute> & {
    header: TableFieldKey<T, S>;
    slotName: TableColumnKey<T, S>;
    prop: TableColumnKey<T, S>;
    formatter: (row: T, column: TableColumn<T, S>, cellValue: any, index: number) => any;
    type: "selection" | "index" | "expand";
    fixed: "left" | "right";
    align: "left" | "center" | "right";
    headerAlign: "left" | "center" | "right";
    filterPlacement:
      | "top"
      | "top-start"
      | "top-end"
      | "bottom"
      | "bottom-start"
      | "bottom-end"
      | "left"
      | "left-start"
      | "left-end"
      | "right"
      | "right-start"
      | "right-end";
  }
>[];

type TableProps<T, S extends string | undefined = undefined> = {
  dataList: T[];
  tableList?: TableColumn<T, S>;
  loading?: boolean;
};

const { dataList, tableList, loading } = defineProps<TableProps<BucketData>>();
</script>

<template>
  <article class="case-card">
    <h2>Imported Generic Table Case</h2>
    <p>{{ dataList.length }} rows</p>
    <p>{{ tableList?.length ?? 0 }} columns</p>
    <p>{{ loading ? "loading" : "ready" }}</p>
  </article>
</template>
