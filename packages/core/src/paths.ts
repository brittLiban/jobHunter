import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export function resolveRepositoryPath(...segments: string[]) {
  return resolve(repositoryRoot, ...segments);
}

export function resolveDataPath(...segments: string[]) {
  return resolve(repositoryRoot, "data", ...segments);
}
