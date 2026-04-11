<script setup lang="ts">
import type { SetOptional, Simplify } from "type-fest";

import type { ThirdPartyShape } from "../types/local";

const props =
  defineProps<Simplify<SetOptional<Pick<ThirdPartyShape, "label" | "size" | "active">, "size">>>();
</script>

<template>
  <article class="case-card">
    <h2>{{ props.label }}</h2>
    <p>active: {{ props.active ? "yes" : "no" }}</p>
    <p>size: {{ props.size ?? "none" }}</p>
  </article>
</template>
