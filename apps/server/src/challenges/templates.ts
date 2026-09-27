import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { ChallengeTemplate, isTimeZone } from "@wickwatch/core";
import type { FastifyBaseLogger } from "fastify";
import Value from "typebox/value";

/**
 * Loads templates/challenges/*.json. Files starting with "_" are examples and skipped;
 * invalid files are logged and skipped, so one broken template does not stop the server.
 */
export async function loadChallengeTemplates(dir: string, log: FastifyBaseLogger): Promise<ChallengeTemplate[]> {
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json") && !f.startsWith("_")).sort();
  } catch {
    log.info({ dir }, "No challenge templates directory");
    return [];
  }
  const templates: ChallengeTemplate[] = [];
  for (const file of files) {
    try {
      const data: unknown = JSON.parse(await readFile(join(dir, file), "utf8"));
      if (!Value.Check(ChallengeTemplate, data)) {
        const errors = Value.Errors(ChallengeTemplate, data).map((e) => `${e.instancePath} ${e.message}`);
        log.warn({ file, errors }, "Invalid challenge template skipped");
      } else if (data.dailyLoss && !isTimeZone(data.dailyLoss.timezone)) {
        log.warn({ file, timezone: data.dailyLoss.timezone }, "Challenge template with unknown time zone skipped");
      } else if (templates.some((t) => t.id === data.id)) {
        log.warn({ file, id: data.id }, "Duplicate challenge template id skipped");
      } else {
        templates.push(data);
      }
    } catch (error) {
      log.warn({ file, err: error }, "Unreadable challenge template skipped");
    }
  }
  return templates;
}
