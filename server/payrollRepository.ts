import { db } from "./db";
import { createPayrollRepository } from "./payrollRepositoryFactory";

export const payrollRepository = createPayrollRepository(db);

export { createPayrollRepository };
