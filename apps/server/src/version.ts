import pkg from "../package.json" with { type: "json" };

/** Release version; the Docker build sets WICKWATCH_VERSION from the Git tag. */
export const VERSION = process.env.WICKWATCH_VERSION ?? pkg.version;
