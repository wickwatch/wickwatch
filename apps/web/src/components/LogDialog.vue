<script setup lang="ts">
import type { LogLine } from "@wickwatch/core";
import AppModal from "./AppModal.vue";
import LogDownload from "./LogDownload.vue";
import LogView, { type LogState } from "./LogView.vue";

/** The larger view of an instance's log, almost full screen, with search and download (log panel, instance tables). */
defineProps<{
  open: boolean;
  title: string;
  instanceRef: string;
  lines: readonly (LogLine & { seq: number })[];
  state: LogState;
}>();
defineEmits<{ close: [] }>();
</script>

<template>
  <AppModal :open="open" :title="title" full @close="$emit('close')">
    <LogView :lines="lines" :state="state" large :instance-ref="instanceRef">
      <template #actions>
        <LogDownload :instance-ref="instanceRef" />
      </template>
    </LogView>
  </AppModal>
</template>
