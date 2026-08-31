import { handleV2Request } from "./v2/app";
import type { WorkerV2Env } from "./v2/db/types";

export default {
  async fetch(request: Request, env: WorkerV2Env): Promise<Response> {
    return handleV2Request(request, env);
  },
};
