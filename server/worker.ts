import { handleV2Request } from "./v2/app";

export default {
  async fetch(request: Request): Promise<Response> {
    return handleV2Request(request);
  },
};
