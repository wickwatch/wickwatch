<script setup lang="ts">
import { computed } from "vue";
import { RouterLink, type RouteLocationRaw } from "vue-router";
import type { IconName } from "../icons";
import AppIcon from "./AppIcon.vue";

/**
 * A button with an icon (BRAND.md, "Buttons and icons"). Icon only by default, with the label as tooltip and accessible
 * name; `showLabel` adds the text for primary page actions and anything destructive. `text` shows a shorter text
 * where the row already says what the action applies to (e.g. "Close" in a positions table); the full label stays the
 * tooltip and accessible name. `tooltip` shows other text than the label, e.g. the description an info button reveals.
 * With `to` it is a link that looks the same, for actions that open a page (edit).
 */
const props = withDefaults(
  defineProps<{
    icon: IconName;
    label: string;
    showLabel?: boolean;
    text?: string | undefined;
    variant?: "default" | "ghost" | "primary" | "danger";
    small?: boolean;
    type?: "button" | "submit";
    to?: RouteLocationRaw | undefined;
    tooltip?: string | undefined;
  }>(),
  {
    showLabel: false,
    text: undefined,
    variant: "default",
    small: false,
    type: "button",
    to: undefined,
    tooltip: undefined,
  },
);
/** A tooltip only where the visible text does not already say it all. */
const tip = computed(() => props.tooltip ?? (props.showLabel ? undefined : props.label));
</script>

<template>
  <component
    :is="to ? RouterLink : 'button'"
    :to="to"
    :type="to ? undefined : type"
    class="btn"
    :class="{
      'btn--icon': !showLabel && !text,
      'btn--small': small,
      'btn--ghost': variant === 'ghost',
      'btn--primary': variant === 'primary',
      'btn--danger': variant === 'danger',
    }"
    :aria-label="showLabel ? undefined : label"
    :data-tooltip="tip"
  >
    <AppIcon :name="icon" :size="small ? 16 : 18" />
    <span v-if="text">{{ text }}</span>
    <span v-else-if="showLabel">{{ label }}</span>
  </component>
</template>
