import { PlatformInfo } from "@wickwatch/core";
import type { FastifyPluginAsyncTypebox } from "@fastify/type-provider-typebox";
import Type from "typebox";
import type { Db } from "../db";
import { actor, requireAdmin } from "../plugins/auth";
import { ErrorBody } from "../plugins/errors";
import { auditOutcome } from "../services/audit";
import { WICKWATCH_REPOSITORY, type Images } from "../services/images";

/** The platform image new instances run on, and newer versions of it and of wickwatch. */
export const platformRoutes: FastifyPluginAsyncTypebox<{ db: Db; images: Images }> = async (app, { db, images }) => {
  const info = (): PlatformInfo => {
    const platform = images.platform();
    const wickwatch = images.updates().wickwatch;
    return {
      ...(platform ? { platform } : {}),
      wickwatch: {
        current: images.version,
        ...(wickwatch ? { latest: wickwatch.latest } : {}),
        ...(images.wickwatchCheckedAt ? { checkedAt: images.wickwatchCheckedAt } : {}),
      },
      updateCheck: images.checking,
    };
  };

  app.get(
    "/platform",
    {
      schema: {
        tags: ["system"],
        summary: "Platform image and available versions",
        description: `Versions come from the image registries, asked once a day (UPDATE_CHECK); wickwatch's own from ${WICKWATCH_REPOSITORY}.`,
        response: { 200: PlatformInfo },
      },
    },
    async () => info(),
  );

  app.put(
    "/platform/image",
    {
      preHandler: requireAdmin,
      schema: {
        tags: ["system"],
        summary: "Set the platform image new instances run on",
        description:
          "Another version of the platform's own repository. Running instances keep theirs until they are updated; the broker's own tools use it from their next start.",
        body: Type.Object({ image: Type.String({ minLength: 1, maxLength: 300 }) }),
        response: { 200: PlatformInfo, 400: ErrorBody, 403: ErrorBody, 501: ErrorBody },
      },
    },
    async (request, reply) => {
      const before = images.platform();
      if (!before) return reply.code(501).send({ error: "image_unsupported" });
      const { image } = request.body;
      if (!images.isAllowed(image)) return reply.code(400).send({ error: "invalid_image" });
      await auditOutcome(
        db,
        { action: "platform.image", target: image, ...actor(request) },
        async () => {
          await images.setImage(image);
          return { from: before.image };
        },
        (result) => result,
      );
      return info();
    },
  );
};
