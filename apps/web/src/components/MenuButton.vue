<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";
import type { IconName } from "../icons";
import AppIcon from "./AppIcon.vue";

export interface MenuItem {
  id: string;
  label: string;
  icon?: IconName;
  /** Image URL shown instead of an icon, e.g. a flag. */
  image?: string;
  /** Set on every item for a single choice (language, theme); the chosen one gets a check mark. */
  checked?: boolean;
  lang?: string;
  /** Draw a divider above this item. */
  separated?: boolean;
  /** Destructive, e.g. delete; shown in the negative colour next to its icon and text. */
  danger?: boolean;
}

/**
 * A button that opens a menu (language, theme, user, "more" actions). Keyboard: arrows, Home/End, Esc closes and
 * returns focus to the button; a click outside closes it. The trigger content comes from the default slot, an optional
 * text above the entries from the `heading` slot.
 *
 * `label` names the menu. An icon trigger (default) also uses it as tooltip and accessible name; a trigger with visible
 * text (`iconTrigger: false`, e.g. the user chip) is named by that text.
 */
const props = withDefaults(
  defineProps<{ label: string; items: MenuItem[]; align?: "start" | "end"; iconTrigger?: boolean }>(),
  { align: "end", iconTrigger: true },
);
const emit = defineEmits<{ select: [id: string] }>();

const open = ref(false);
/** The side the menu is anchored to; flips when the preferred side would push it off screen (wrapped buttons on phones). */
const side = ref(props.align);
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const menuId = useId();
const choice = computed(() => props.items.some((i) => i.checked !== undefined));

// Read from the DOM: template ref arrays in v-for do not keep the item order.
const entries = () => [...(menu.value?.querySelectorAll<HTMLButtonElement>(".menu__item") ?? [])];

function focusEntry(index: number) {
  const list = entries();
  if (list.length) list[(index + list.length) % list.length]?.focus();
}

async function show(at: "chosen" | "first" | "last") {
  side.value = props.align;
  open.value = true;
  await nextTick();
  const box = menu.value?.getBoundingClientRect();
  if (box && (box.left < 0 || box.right > document.documentElement.clientWidth)) {
    side.value = props.align === "end" ? "start" : "end";
  }
  const chosen = props.items.findIndex((i) => i.checked);
  focusEntry(at === "last" ? -1 : at === "chosen" && chosen >= 0 ? chosen : 0);
}

function hide(returnFocus = true) {
  open.value = false;
  if (returnFocus) trigger.value?.focus();
}

function onTriggerKey(event: KeyboardEvent) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  void show(event.key === "ArrowUp" ? "last" : "chosen");
}

function onMenuKey(event: KeyboardEvent) {
  const current = entries().indexOf(document.activeElement as HTMLButtonElement);
  const moves: Record<string, number> = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: -1 };
  if (event.key in moves) {
    event.preventDefault();
    focusEntry(moves[event.key] ?? 0);
  } else if (event.key === "Escape") {
    event.preventDefault();
    hide();
  } else if (event.key === "Tab") {
    hide(false);
  }
}

function choose(item: MenuItem) {
  emit("select", item.id);
  hide();
}

function onOutside(event: PointerEvent) {
  if (!root.value?.contains(event.target as Node)) hide(false);
}

watch(open, (isOpen) =>
  isOpen ? document.addEventListener("pointerdown", onOutside) : document.removeEventListener("pointerdown", onOutside),
);
onBeforeUnmount(() => document.removeEventListener("pointerdown", onOutside));
</script>

<template>
  <div ref="root" class="menu-button">
    <button
      ref="trigger"
      type="button"
      :class="iconTrigger ? 'btn btn--ghost btn--icon' : 'menu-button__plain'"
      :aria-label="iconTrigger ? label : undefined"
      :data-tooltip="iconTrigger ? label : undefined"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      @click="open ? hide(false) : show('chosen')"
      @keydown="onTriggerKey"
    >
      <slot />
    </button>
    <div
      v-if="open"
      :id="menuId"
      ref="menu"
      class="menu panel"
      :class="`menu--${side}`"
      role="menu"
      :aria-label="label"
      @keydown="onMenuKey"
    >
      <div v-if="$slots.heading" class="menu__heading" role="none"><slot name="heading" /></div>
      <template v-for="item in items" :key="item.id">
        <div v-if="item.separated" class="menu__separator" role="separator" />
        <button
          type="button"
          class="menu__item"
          :class="{ 'menu__item--danger': item.danger }"
          :role="choice ? 'menuitemradio' : 'menuitem'"
          :aria-checked="choice ? !!item.checked : undefined"
          :lang="item.lang"
          tabindex="-1"
          @click="choose(item)"
        >
          <img v-if="item.image" :src="item.image" alt="" class="menu__image" />
          <AppIcon v-else-if="item.icon" :name="item.icon" />
          <span class="menu__label">{{ item.label }}</span>
          <AppIcon v-if="item.checked" name="check" class="menu__check" />
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped>
.menu-button {
  position: relative;
}

.menu-button__plain {
  display: flex;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.menu {
  position: absolute;
  top: calc(100% + var(--ww-space-1));
  z-index: 10;
  display: flex;
  flex-direction: column;
  min-width: 190px;
  padding: var(--ww-space-1);
  border-color: var(--ww-border-strong);
  border-radius: var(--ww-radius-lg);
  box-shadow: 0 8px 24px color-mix(in srgb, var(--ww-bg) 70%, transparent);
}

.menu--end {
  right: 0;
}

.menu--start {
  left: 0;
}

.menu__item {
  display: flex;
  align-items: center;
  gap: var(--ww-space-3);
  min-height: 40px;
  padding: var(--ww-space-2) var(--ww-space-3);
  border: 0;
  border-radius: var(--ww-radius-md);
  background: transparent;
  color: var(--ww-text);
  font: inherit;
  font-size: var(--ww-size-sm);
  text-align: left;
  cursor: pointer;
}

.menu__item:hover,
.menu__item:focus-visible {
  background: var(--ww-surface-raised);
}

.menu__item--danger {
  color: var(--ww-negative);
}

.menu__item[aria-checked="true"] {
  font-weight: 600;
}

.menu__label {
  flex: 1;
  white-space: nowrap;
}

.menu__heading {
  padding: var(--ww-space-2) var(--ww-space-3);
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
  font-weight: 600;
}

.menu__separator {
  margin: var(--ww-space-1) 0;
  border-top: 1px solid var(--ww-border);
}

.menu__image {
  width: 20px;
  height: 15px;
  border-radius: 2px;
  box-shadow: 0 0 0 1px var(--ww-border-strong);
}

.menu__check {
  color: var(--ww-text);
}

@media (pointer: coarse) {
  .menu__item {
    min-height: var(--ww-touch-target);
  }
}
</style>
