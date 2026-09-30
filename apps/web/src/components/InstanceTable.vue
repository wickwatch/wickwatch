<script setup lang="ts">
import type { InstanceSummary } from "@wickwatch/core";
import { useI18n } from "vue-i18n";
import type { InstanceAction } from "../api";
import { durationParts } from "../format";
import { isActive } from "../instance-state";
import IconButton from "./IconButton.vue";
import SignedValue from "./SignedValue.vue";
import StatusBadge from "./StatusBadge.vue";

withDefaults(
  defineProps<{
    instances: InstanceSummary[];
    accountNames: ReadonlyMap<string, string>;
    busy: ReadonlySet<string>;
    now: number;
    /** Viewers see no action buttons. */
    canAct: boolean;
    /** Off on the account page, where every row is on that account. */
    showAccount?: boolean;
  }>(),
  { showAccount: true },
);
defineEmits<{ action: [instance: InstanceSummary, action: InstanceAction] }>();

const { t } = useI18n();
const uptime = (instance: InstanceSummary, now: number) => {
  if (instance.status !== "running" || !instance.startedAt) return t("format.none");
  const { key, params } = durationParts(instance.startedAt, now);
  return t(key, params);
};
</script>

<template>
  <div class="panel table-wrap">
    <table class="table">
      <thead>
        <tr>
          <th scope="col">{{ $t("table.instance") }}</th>
          <th v-if="showAccount" scope="col" class="wide">{{ $t("table.account") }}</th>
          <th scope="col" class="wide">{{ $t("table.symbol") }}</th>
          <th scope="col" class="wide">{{ $t("table.period") }}</th>
          <th scope="col">{{ $t("table.status") }}</th>
          <th scope="col" class="wide">{{ $t("table.uptime") }}</th>
          <th scope="col" class="wide num">{{ $t("table.positions") }}</th>
          <th scope="col" class="num">{{ $t("table.dayPnl") }}</th>
          <th scope="col" class="wide">{{ $t("table.lastLog") }}</th>
          <th v-if="canAct" scope="col" class="num">{{ $t("table.actions") }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="instance in instances" :key="instance.ref">
          <th scope="row">
            <RouterLink :to="{ name: 'instance', params: { ref: instance.ref } }" class="mono name">{{
              instance.name
            }}</RouterLink>
            <!-- Compact meta line for narrow screens, where the detail columns are hidden. -->
            <span class="narrow muted mono meta">{{
              [instance.symbol, instance.period].filter(Boolean).join(" · ")
            }}</span>
          </th>
          <td v-if="showAccount" class="wide">
            {{
              instance.account
                ? [accountNames.get(instance.account), instance.account].filter(Boolean).join(" · ")
                : $t("format.none")
            }}
          </td>
          <td class="wide mono">{{ instance.symbol ?? $t("format.none") }}</td>
          <td class="wide mono">{{ instance.period ?? $t("format.none") }}</td>
          <td><StatusBadge :instance="instance.status" :connection-lost="!!instance.connectionLostSince" /></td>
          <td class="wide mono muted">{{ uptime(instance, now) }}</td>
          <td class="wide mono num">{{ instance.openPositions }}</td>
          <td class="num"><SignedValue :value="instance.dayPnl" /></td>
          <td class="wide log mono" :class="instance.lastLog?.level ? `log--${instance.lastLog.level}` : ''">
            <span :title="instance.lastLog?.text">{{ instance.lastLog?.text ?? "" }}</span>
          </td>
          <td v-if="canAct">
            <div class="actions">
              <IconButton
                v-if="isActive(instance.status)"
                icon="stop"
                :label="$t('table.actionOn', { action: $t('action.stop'), name: instance.name })"
                small
                :disabled="busy.has(instance.ref)"
                @click="$emit('action', instance, 'stop')"
              />
              <IconButton
                v-else
                icon="play"
                :label="$t('table.actionOn', { action: $t('action.start'), name: instance.name })"
                small
                :disabled="busy.has(instance.ref)"
                @click="$emit('action', instance, 'start')"
              />
              <IconButton
                class="wide"
                icon="restart"
                :label="$t('table.actionOn', { action: $t('action.restart'), name: instance.name })"
                small
                :disabled="busy.has(instance.ref)"
                @click="$emit('action', instance, 'restart')"
              />
            </div>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.table-wrap {
  overflow-x: auto;
}

.table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--ww-size-sm);
}

th,
td {
  padding: var(--ww-space-3) var(--ww-space-4);
  border-bottom: 1px solid var(--ww-border);
  text-align: left;
  vertical-align: middle;
  white-space: nowrap;
}

tbody tr:last-child > * {
  border-bottom: 0;
}

thead th {
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
}

tbody th {
  font-weight: 600;
}

.name {
  display: block;
}

.num {
  text-align: right;
}

.log {
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--ww-text-muted);
  font-size: var(--ww-size-xs);
}

.log--warn {
  color: var(--ww-warning);
}

.log--error {
  color: var(--ww-negative);
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.narrow {
  display: none;
}

.meta {
  font-size: var(--ww-size-xs);
  font-weight: 400;
}

@media (max-width: 900px) {
  .wide {
    display: none;
  }

  th,
  td {
    padding: var(--ww-space-3) var(--ww-space-2);
  }

  thead th {
    letter-spacing: 0;
  }

  tr > :first-child {
    padding-left: var(--ww-space-3);
  }

  tr > :last-child {
    padding-right: var(--ww-space-3);
  }

  .narrow {
    display: block;
  }
}
</style>
