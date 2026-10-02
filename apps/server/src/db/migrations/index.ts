import type { Migration } from "kysely/migration";
import { initial } from "./0001-initial";
import { sessions } from "./0002-sessions";
import { challenges } from "./0003-challenges";
import { attributionOverrides } from "./0004-attribution-overrides";
import { algos } from "./0005-algos";
import { instances } from "./0006-instances";
import { notifiedAlerts } from "./0007-notified-alerts";
import { guardTrips } from "./0008-guard-trips";
import { colorParameters } from "./0009-color-parameters";
import { algoMetadataReader } from "./0010-algo-metadata-reader";
import { instanceShouldRun } from "./0011-instance-should-run";
import { tradingDaysFrom } from "./0012-trading-days-from";
import { dailySummaries } from "./0013-daily-summaries";
import { instanceStoppedByUser } from "./0014-instance-stopped-by-user";
import { apiTokens } from "./0015-api-tokens";
import { auditApiToken } from "./0016-audit-api-token";
import { parameterTemplates } from "./0017-parameter-templates";
import { algoSettings } from "./0018-algo-settings";

// Migrations are imported statically so they end up in the server bundle.
// Keys sort lexicographically and define the order; never rename or remove one.
export const migrations: Record<string, Migration> = {
  "0001-initial": initial,
  "0002-sessions": sessions,
  "0003-challenges": challenges,
  "0004-attribution-overrides": attributionOverrides,
  "0005-algos": algos,
  "0006-instances": instances,
  "0007-notified-alerts": notifiedAlerts,
  "0008-guard-trips": guardTrips,
  "0009-color-parameters": colorParameters,
  "0010-algo-metadata-reader": algoMetadataReader,
  "0011-instance-should-run": instanceShouldRun,
  "0012-trading-days-from": tradingDaysFrom,
  "0013-daily-summaries": dailySummaries,
  "0014-instance-stopped-by-user": instanceStoppedByUser,
  "0015-api-tokens": apiTokens,
  "0016-audit-api-token": auditApiToken,
  "0017-parameter-templates": parameterTemplates,
  "0018-algo-settings": algoSettings,
};
