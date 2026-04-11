<script setup lang="ts">
import type { LocalCardShape } from "../types/local";

const modes = ["compact", "detail"] as const;

const props = defineProps<
  Readonly<
    Pick<LocalCardShape, "title" | "pinned"> &
      Partial<Pick<LocalCardShape, "count">> & {
        mode: (typeof modes)[number];
      }
  >
>();
</script>

<template>
  <article class="case-card">
    <h2>{{ props.title }}</h2>
    <p>mode: {{ props.mode }}</p>
    <p>count: {{ props.count ?? "none" }}</p>
    <p>pinned: {{ props.pinned ? "yes" : "no" }}</p>
  </article>
</template>
