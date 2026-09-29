<script setup lang="ts">
import { computed } from "vue";
import { ICONS, type IconName } from "../icons";

const props = withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 18 });
const shapes = computed(() => ICONS[props.name].map(({ tag, ...attrs }) => ({ tag, attrs })));
</script>

<template>
  <!-- Decorative: the button or text next to it carries the label. -->
  <svg
    class="icon"
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <component :is="shape.tag" v-for="(shape, n) in shapes" :key="n" v-bind="shape.attrs" />
  </svg>
</template>

<style scoped>
.icon {
  flex: none;
}
</style>
