import Type from "typebox";

export const AuditRecord = Type.Object({
  id: Type.Integer(),
  time: Type.String(),
  /** The user who acted; missing for Wickwatch itself (loss guard, autostart) and failed logins. */
  user: Type.Optional(Type.String()),
  action: Type.String(),
  target: Type.Optional(Type.String()),
  details: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type AuditRecord = Type.Static<typeof AuditRecord>;

/** A page of the audit log, newest first. */
export const AuditPage = Type.Object({
  entries: Type.Array(AuditRecord),
  /** More entries exist before the last one. */
  more: Type.Boolean(),
  /** Every action in the log, for the filter. */
  actions: Type.Array(Type.String()),
});
export type AuditPage = Type.Static<typeof AuditPage>;
