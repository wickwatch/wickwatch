import Type from "typebox";
import { TimeOfDay } from "./challenge";

// Schedules pause bot instances on weekends, holidays and around economic news (services/scheduler.ts on the server).

/** A day as YYYY-MM-DD. */
const Day = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
/** A local day and time as YYYY-MM-DDTHH:MM, as a datetime-local input gives it. */
const DayTime = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T([01]\\d|2[0-3]):[0-5]\\d$" });

/** A time of the week: `day` 0 is Sunday. */
export const WeekTime = Type.Object({ day: Type.Integer({ minimum: 0, maximum: 6 }), time: TimeOfDay });
export type WeekTime = Type.Static<typeof WeekTime>;

/** Impact of news a schedule can pause for; the calendar's low-impact events are not kept. */
export const NewsImpact = Type.Union([Type.Literal("high"), Type.Literal("medium")]);
export type NewsImpact = Type.Static<typeof NewsImpact>;

export const ScheduleRules = Type.Object({
  /** IANA time zone of the times and days, e.g. "Europe/Berlin". */
  timezone: Type.String({ minLength: 1, maxLength: 64 }),
  /** Paused from `from` to the next `to`, every week. */
  weekend: Type.Optional(Type.Object({ from: WeekTime, to: WeekTime })),
  /** Whole days, `to` included. */
  holidays: Type.Array(
    Type.Object({ from: Day, to: Type.Optional(Day), name: Type.Optional(Type.String({ maxLength: 100 })) }),
    { maxItems: 200 },
  ),
  /** One-off pauses from a day and time to another, e.g. for a broker's maintenance. */
  periods: Type.Optional(
    Type.Array(Type.Object({ from: DayTime, to: DayTime, name: Type.Optional(Type.String({ maxLength: 100 })) }), {
      maxItems: 200,
    }),
  ),
  /** Paused from `before` minutes before to `after` minutes after news of these currencies of at least `impact`. */
  news: Type.Optional(
    Type.Object({
      currencies: Type.Array(Type.String({ pattern: "^[A-Z]{3}$" }), { minItems: 1, maxItems: 20 }),
      /** The least impact that pauses. */
      impact: NewsImpact,
      before: Type.Integer({ minimum: 0, maximum: 240 }),
      after: Type.Integer({ minimum: 0, maximum: 240 }),
    }),
  ),
});
export type ScheduleRules = Type.Static<typeof ScheduleRules>;

/** An economic news event of the calendar (NEWS_CALENDAR_URL). */
export const NewsEvent = Type.Object({
  time: Type.String({ format: "date-time" }),
  currency: Type.String(),
  impact: NewsImpact,
  title: Type.String(),
});
export type NewsEvent = Type.Static<typeof NewsEvent>;

export const PauseReason = Type.Union([
  Type.Literal("weekend"),
  Type.Literal("holiday"),
  Type.Literal("period"),
  Type.Literal("news"),
]);
export type PauseReason = Type.Static<typeof PauseReason>;

/** A time a schedule pauses its instances; overlapping and touching ones are merged. */
export const PauseWindow = Type.Object({
  start: Type.String({ format: "date-time" }),
  end: Type.String({ format: "date-time" }),
  reasons: Type.Array(PauseReason),
  /** The holidays' names and the news, e.g. "USD Non-Farm Employment Change". */
  labels: Type.Array(Type.String()),
});
export type PauseWindow = Type.Static<typeof PauseWindow>;

/** An instance its schedule holds stopped: until when, and why. */
export const InstancePause = Type.Object({
  until: Type.String({ format: "date-time" }),
  reasons: Type.Array(PauseReason),
});
export type InstancePause = Type.Static<typeof InstancePause>;

export const Schedule = Type.Object({
  id: Type.Integer(),
  name: Type.String(),
  rules: ScheduleRules,
  /** Names of the instances that use it. */
  instances: Type.Array(Type.String()),
  /** The current or next pause within 14 days. */
  nextPause: Type.Optional(PauseWindow),
  createdAt: Type.String(),
  createdBy: Type.Optional(Type.String()),
  updatedAt: Type.String(),
  updatedBy: Type.Optional(Type.String()),
});
export type Schedule = Type.Static<typeof Schedule>;

export const ScheduleInput = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 100 }),
  rules: ScheduleRules,
  /** The managed instances it pauses, by name; left out: they stay as they are. */
  instances: Type.Optional(Type.Array(Type.String({ minLength: 1, maxLength: 100 }), { maxItems: 500 })),
});
export type ScheduleInput = Type.Static<typeof ScheduleInput>;
