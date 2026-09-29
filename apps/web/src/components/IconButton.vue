<script setup lang="ts">
import type { IconName } from "../icons";
import AppIcon from "./AppIcon.vue";

/**
 * A button with an icon (BRAND.md, "Buttons and icons"). Icon only by default, with the label as tooltip and accessible
 * name; `showLabel` adds the text for primary page actions and anything destructive.
 */
withDefaults(
  defineProps<{
    icon: IconName;
    label: string;
    showLabel?: boolean;
    variant?: "default" | "ghost" | "primary" | "danger";
    small?: boolean;
    type?: "button" | "submit";
  }>(),
  { showLabel: false, variant: "default", small: false, type: "button" },
);
</script>

<template>
  <button
    :type="type"
    class="btn"
    :class="{
      'btn--icon': !showLabel,
      'btn--small': small,
      'btn--ghost': variant === 'ghost',
      'btn--primary': variant === 'primary',
      'btn--danger': variant === 'danger',
    }"
    :aria-label="showLabel ? undefined : label"
    :title="showLabel ? undefined : label"
  >
    <AppIcon :name="icon" :size="small ? 16 : 18" />
    <span v-if="showLabel">{{ label }}</span>
  </button>
</template>
