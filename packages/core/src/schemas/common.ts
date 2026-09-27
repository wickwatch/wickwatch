import Type from "typebox";

export const Id = Type.String({ minLength: 1 });
export type Id = Type.Static<typeof Id>;

/** ISO 8601 timestamp, always UTC (`Z` suffix). */
export const IsoTime = Type.String({ format: "date-time", pattern: "Z$" });
export type IsoTime = Type.Static<typeof IsoTime>;

export const Money = Type.Object({
  amount: Type.Number(),
  currency: Type.String({ minLength: 3, maxLength: 3 }),
});
export type Money = Type.Static<typeof Money>;

export const Side = Type.Union([Type.Literal("buy"), Type.Literal("sell")]);
export type Side = Type.Static<typeof Side>;

/** Labels attached to a runtime instance; keys carry the configurable prefix. */
export const Labels = Type.Record(Type.String(), Type.String());
export type Labels = Type.Static<typeof Labels>;

export function toIsoTime(date: Date): IsoTime {
  return date.toISOString();
}
