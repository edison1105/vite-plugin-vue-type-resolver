<script setup lang="ts">
import GlobalAmbientCase from "./components/GlobalAmbientCase.vue";
import LocalComplexCase from "./components/LocalComplexCase.vue";
import ThirdPartyCase from "./components/ThirdPartyCase.vue";
</script>

<template>
  <main class="app-shell">
    <header class="hero">
      <p class="eyebrow">tsgo + vue defineProps</p>
      <h1>Compiled Output Playground</h1>
      <p class="lede">
        These components exist to verify that complex root prop types are lowered before Vue infers
        runtime props.
      </p>
    </header>

    <section class="case-grid">
      <LocalComplexCase title="Local Complex Case" :pinned="true" :count="3" mode="compact" />
      <GlobalAmbientCase tone="warm" :version="7" />
      <ThirdPartyCase label="Third Party Case" :active="true" />
    </section>
  </main>
</template>
