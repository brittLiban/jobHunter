import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { resolveDataPath } from "@jobhunter/core";

export async function saveUploadedResumeFile(file: File) {
  const root = resolveDataPath("uploads", "resumes");
  await mkdir(root, { recursive: true });

  const safeName = basename(file.name || "resume").replace(/[^a-zA-Z0-9._-]+/g, "-");
  const id = randomUUID();
  const fileName = `${id}${extname(safeName) || ".bin"}`;
  const path = join(root, fileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(path, buffer);

  return {
    absolutePath: path,
    storageKey: `uploads/resumes/${fileName}`,
  };
}
