import bcrypt from "bcrypt";

export async function hashPassword(password: string): Promise<string> {
  const saltRounds = 12;
  return await bcrypt.hash(password, saltRounds);
}

export async function comparePassword(
  password: string,
  hash: string | null | undefined,
): Promise<boolean> {
  if (!hash) {
    return false;
  }

  return await bcrypt.compare(password, hash);
}
