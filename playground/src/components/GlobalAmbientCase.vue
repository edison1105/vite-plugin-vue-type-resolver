<script setup lang="ts">
const props = defineProps<GlobalAmbientProps>();
</script>

<template>
  <article class="case-card">
    <h2>Global Ambient Case</h2>
    <p>tone: {{ props.tone }}</p>
    <p>version: {{ props.version ?? "none" }}</p>
    <p>pinned: {{ props.pinned ? "yes" : "no" }}</p>
  </article>
</template>
