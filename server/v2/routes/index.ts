import { financeRouteModule } from "./finance";
import { staffRouteModule } from "./staff";
import { verifierRouteModule } from "./verifier";

export const v2RouteModules = [
  staffRouteModule,
  financeRouteModule,
  verifierRouteModule,
] as const;
