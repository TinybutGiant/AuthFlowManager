import { db } from "./db";
import { createTaxRepository } from "./taxRepositoryFactory";

export { createTaxRepository } from "./taxRepositoryFactory";

export const taxRepository = createTaxRepository(db);
