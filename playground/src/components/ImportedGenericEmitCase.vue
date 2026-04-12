<script setup lang="ts">
import { ElTable } from "element-plus";
import type { ComponentEmit } from "vue-component-type-helpers";

type TableEmits = ComponentEmit<typeof ElTable>;

const emit = defineEmits<TableEmits>();

void emit;
</script>

<template>
  <article class="case-card">
    <h2>Imported Generic Emit Case</h2>
    <p>Runtime emits come from a third-party helper type.</p>
  </article>
</template>
