<script setup lang="ts">
import { ref } from "vue";
import { useLogStream } from "../composables/useLogStream";
import IconButton from "./IconButton.vue";
import LogDialog from "./LogDialog.vue";
import LogDownload from "./LogDownload.vue";
import LogView from "./LogView.vue";

/**
 * The live log of an instance, with a larger view and a download. One stream feeds both views.
 * `running`: the container runs. A stopped container sends its last lines and then ends the stream.
 */
const props = defineProps<{ instanceRef: string; running: boolean }>();
const { lines, state } = useLogStream(() => ({ ref: props.instanceRef, running: props.running }));
const expanded = ref(false);
</script>

<template>
  <div class="log-panel">
    <LogView :lines="lines" :state="state">
      <template #actions>
        <LogDownload :instance-ref="instanceRef" />
        <IconButton icon="expand" :label="$t('log.expand')" variant="ghost" @click="expanded = true" />
      </template>
    </LogView>
    <LogDialog
      :open="expanded"
      :title="$t('instance.liveLog')"
      :instance-ref="instanceRef"
      :lines="lines"
      :state="state"
      @close="expanded = false"
    />
  </div>
</template>

<style scoped>
.log-panel {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
</style>
