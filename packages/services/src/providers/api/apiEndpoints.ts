import { buildRuntimeZCodeApiUrl } from "@zcode/shared";

export const ZCODE_CLIENT_SCENES_URL = buildRuntimeZCodeApiUrl(
  process.env,
  "/api/v1/client/scenes",
);
