import type { AccountSizeCheck, ParameterSchema, ParameterValues } from "@wickwatch/core";
import { accountSizeMismatch } from "@wickwatch/core/parameters";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { formatDecimal, formatNumber } from "../format";
import { parameterTitle } from "../parameter-label";

/**
 * The warning when the parameter an algo names as its account size (Algos page) is far off the account's size, which
 * the server resolves (`Account.accountSize`, `ManagedInstanceDetail.accountSizeCheck`). `text` for a banner or
 * dialog, `warnings` for the parameter list; nothing without a check or without values (viewers get none).
 */
export function useAccountSizeWarning(options: {
  check: () => AccountSizeCheck | undefined;
  values: () => ParameterValues;
  schema: () => ParameterSchema[];
}) {
  const { t, locale } = useI18n();

  const mismatch = computed(() => {
    const check = options.check();
    return check && accountSizeMismatch(options.values(), check.parameter, check.reference.value);
  });

  const text = computed(() => {
    const found = mismatch.value;
    const basis = options.check()?.reference.basis;
    if (!found || !basis) return undefined;
    const high = found.value > found.reference;
    return t(high ? "accountSize.tooHigh" : "accountSize.tooLow", {
      parameter: parameterTitle(options.schema(), found.parameter),
      value: formatNumber(locale.value, found.value),
      basis: t(`accountSize.basis.${basis}`),
      reference: formatNumber(locale.value, found.reference),
      factor: formatDecimal(locale.value, high ? found.value / found.reference : found.reference / found.value),
    });
  });

  const warnings = computed(() =>
    mismatch.value && text.value ? new Map([[mismatch.value.parameter, text.value]]) : undefined,
  );

  return { text, warnings };
}
