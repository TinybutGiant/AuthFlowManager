import { financeRouteModule } from "./finance";
import { payrollRouteModule } from "./payroll";
import { staffRouteModule } from "./staff";
import { verifierRouteModule } from "./verifier";

export const v2RouteModules = [
  staffRouteModule,
  financeRouteModule,
  payrollRouteModule,
  verifierRouteModule,
] as const;
