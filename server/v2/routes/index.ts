import { financeRouteModule } from "./finance";
import { payrollRouteModule } from "./payroll";
import { staffRouteModule } from "./staff";
import { taxRouteModule } from "./tax";
import { verifierRouteModule } from "./verifier";

export const v2RouteModules = [
  staffRouteModule,
  financeRouteModule,
  payrollRouteModule,
  taxRouteModule,
  verifierRouteModule,
] as const;
