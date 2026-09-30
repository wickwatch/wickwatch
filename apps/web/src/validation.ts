import { computed, ref, watch, type ComputedRef, type Directive, type Ref } from "vue";
import { INSTANCE_NAME, SAFE_NAME } from "@wickwatch/core/rules";
import { isTimeZone } from "@wickwatch/core/trading-day";
import { ApiError } from "./api";

// Field checks shared by all forms: a check returns an i18n message or nothing. The server checks
// again; these only tell the user earlier and next to the field. Forms use `novalidate`, so the
// messages are ours (translated) and not the browser's.

export interface FieldMessage {
  key: string;
  params?: Record<string, string | number>;
  /** Shown while typing; other messages wait until the field is left or the form is sent. */
  live?: boolean;
}

export type Check = (value: unknown) => FieldMessage | undefined;

const text = (value: unknown) => (value === undefined || value === null ? "" : String(value));
const isEmpty = (value: unknown) => text(value).trim() === "";

/** Characters in `value` outside `allowed`, each once, for the message. */
function foreign(value: string, allowed: RegExp): string | undefined {
  const found = [...new Set([...value].filter((c) => !allowed.test(c)))];
  return found.length ? found.map((c) => (c === " " ? "␣" : c)).join(" ") : undefined;
}

/** A value that follows `pattern`; characters outside `chars` are reported while typing. */
const format =
  (pattern: RegExp, chars: RegExp, key: string): Check =>
  (value) => {
    const v = text(value);
    if (!v) return undefined;
    const bad = foreign(v, chars);
    if (bad) return { key: "validation.characters", params: { chars: bad }, live: true };
    return pattern.test(v) ? undefined : { key };
  };

/** The server's minimum, shared through the core. */
export { MIN_PASSWORD_LENGTH } from "@wickwatch/core/rules";

export const checks = {
  required: ((value) => (isEmpty(value) ? { key: "validation.required" } : undefined)) as Check,
  /** Also the container name and the default order label. */
  instanceName: format(INSTANCE_NAME, /[a-z0-9-]/, "validation.instanceName"),
  version: format(SAFE_NAME, /[A-Za-z0-9._-]/, "validation.version"),
  username: format(/^[A-Za-z0-9._@-]+$/, /[A-Za-z0-9._@-]/, "validation.username"),
  code: format(/^\d{6,8}$/, /\d/, "validation.code"),
  accountNumber: format(/^\d+$/, /\d/, "validation.accountNumber"),
  minLength:
    (min: number): Check =>
    (value) =>
      text(value) && text(value).length < min ? { key: "validation.minLength", params: { min } } : undefined,
  sameAs:
    (other: () => unknown): Check =>
    (value) =>
      text(value) && text(value) !== text(other()) ? { key: "validation.mismatch" } : undefined,
  /** One of `options` (case-insensitive), when the options are known. */
  oneOf:
    (options: () => string[], key: string): Check =>
    (value) => {
      const v = text(value).trim().toLowerCase();
      const list = options();
      return v && list.length && !list.some((o) => o.toLowerCase() === v) ? { key } : undefined;
    },
  regex: ((value) => {
    try {
      new RegExp(text(value));
      return undefined;
    } catch {
      return { key: "validation.regex" };
    }
  }) as Check,
  timeZone: ((value) =>
    isEmpty(value) || isTimeZone(text(value)) ? undefined : { key: "validation.timeZone" }) as Check,
  /** Numbers from `v-model.number`: an empty field is a string, a partial one too. */
  number:
    ({ min, max, integer = false }: { min?: number; max?: number; integer?: boolean }): Check =>
    (value) => {
      if (isEmpty(value)) return undefined;
      const n = typeof value === "number" ? value : Number(text(value));
      if (!Number.isFinite(n) || (integer && !Number.isInteger(n))) {
        return { key: integer ? "validation.integer" : "validation.number" };
      }
      if (min !== undefined && n < min) return { key: "validation.min", params: { min } };
      if (max !== undefined && n > max) return { key: "validation.max", params: { max } };
      return undefined;
    },
};

/** Rewrites what is typed, e.g. to lower case, keeping the cursor where it was. */
export const normalizers = {
  /** Instance names: lower case; spaces and underscores become hyphens. */
  slug: (v: string) => v.toLowerCase().replace(/[\s_]/g, "-"),
  /** Account numbers and codes: spaces and separators are dropped. */
  digits: (v: string) => v.replace(/[\s.\-/]/g, ""),
  noSpaces: (v: string) => v.replace(/\s/g, ""),
  /** Versions and similar identifiers: spaces become hyphens. */
  hyphenate: (v: string) => v.replace(/\s/g, "-"),
};

const normalizerOf = new WeakMap<HTMLInputElement, (v: string) => string>();

/** `v-normalize="normalizers.slug"` on an input with v-model. */
export const vNormalize: Directive<HTMLInputElement, (v: string) => string> = {
  mounted(el, binding) {
    normalizerOf.set(el, binding.value);
    el.addEventListener("input", () => {
      const next = normalizerOf.get(el)?.(el.value) ?? el.value;
      if (next === el.value) return;
      const at = el.selectionStart;
      const sameLength = next.length === el.value.length;
      el.value = next;
      if (at !== null && sameLength) el.setSelectionRange(at, at);
      // v-model has read the raw value already; this tells it the new one.
      el.dispatchEvent(new Event("input"));
    });
  },
  updated(el, binding) {
    normalizerOf.set(el, binding.value);
  },
};

export interface Field {
  id: string;
  /** The message to show now, if any. */
  shown: ComputedRef<FieldMessage | undefined>;
  error: ComputedRef<FieldMessage | undefined>;
  /** A problem the server reported for this field; cleared when the value changes. */
  server: Ref<FieldMessage | undefined>;
  /** Bind to the input: `v-bind="name.attrs.value"`. */
  attrs: ComputedRef<Record<string, string | undefined | (() => void)>>;
}

let counter = 0;

/** Field state for one form. `validate()` before sending; `fromServer()` after a rejected request. */
export function useValidation() {
  const submitted = ref(false);
  const fields: Field[] = [];
  const touchedFlags: Ref<boolean>[] = [];

  function field(value: () => unknown, ...fieldChecks: (Check | false | undefined)[]): Field {
    const id = `field-${String(++counter)}`;
    const touched = ref(false);
    touchedFlags.push(touched);
    const server = ref<FieldMessage>();
    watch(value, () => {
      server.value = undefined;
    });
    const error = computed(() => {
      if (server.value) return server.value;
      for (const check of fieldChecks) {
        const message = check ? check(value()) : undefined;
        if (message) return message;
      }
      return undefined;
    });
    const shown = computed(() =>
      error.value && (submitted.value || touched.value || error.value.live || server.value) ? error.value : undefined,
    );
    const attrs = computed(() => ({
      "data-field": id,
      "aria-invalid": shown.value ? "true" : undefined,
      "aria-describedby": shown.value ? `${id}-error` : undefined,
      onBlur: () => {
        touched.value = true;
      },
    }));
    const f: Field = { id, shown, error, server, attrs };
    fields.push(f);
    return f;
  }

  /** Shows all problems; true when there are none, else the first problem field gets the focus. */
  function validate(): boolean {
    submitted.value = true;
    const bad = fields.find((f) => f.error.value);
    if (bad) document.querySelector<HTMLElement>(`[data-field="${bad.id}"]`)?.focus();
    return !bad;
  }

  /**
   * Puts a rejected request's field problem ("body/name must match …") onto its field.
   * `paths` maps request paths (`name`, `config/symbol`) to fields. True when one was found.
   */
  function fromServer(error: unknown, paths: Record<string, Field>): boolean {
    const path = error instanceof ApiError ? /^body\/(\S+)/.exec(error.details.message ?? "")?.[1] : undefined;
    const target = path ? paths[path] : undefined;
    if (!target) return false;
    target.server.value = { key: "validation.rejected" };
    submitted.value = true;
    document.querySelector<HTMLElement>(`[data-field="${target.id}"]`)?.focus();
    return true;
  }

  /** After a successful send that cleared the form: nothing is shown until the next attempt. */
  function reset(): void {
    submitted.value = false;
    for (const touched of touchedFlags) touched.value = false;
    for (const f of fields) f.server.value = undefined;
  }

  return { field, validate, fromServer, reset };
}
