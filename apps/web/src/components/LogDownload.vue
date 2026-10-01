<script setup lang="ts">
import type { LogPeriod } from "@wickwatch/core";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { api, downloadFile } from "../api";
import AppIcon from "./AppIcon.vue";
import MenuButton, { type MenuItem } from "./MenuButton.vue";

/** Downloads an instance's log as a text file; the menu asks how far back. */
const props = defineProps<{ instanceRef: string }>();
const { t } = useI18n();

const PERIODS: LogPeriod[] = ["24h", "7d", "all"];
const items = computed<MenuItem[]>(() => PERIODS.map((p) => ({ id: p, label: t(`log.periods.${p}`) })));
const download = (period: string) => downloadFile(api.logDownloadUrl(props.instanceRef, period as LogPeriod));
</script>

<template>
  <MenuButton :label="$t('log.download')" :items="items" @select="download">
    <AppIcon name="download" />
  </MenuButton>
</template>
