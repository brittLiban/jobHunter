import { resumeUploadInputSchema } from "@jobhunter/core";
import { createResumeForUser, listResumesForUser } from "@jobhunter/db";
import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/lib/auth";
import { saveUploadedResumeFile } from "@/lib/uploads";

export async function GET() {
  const user = await requireCurrentUser();
  const resumes = await listResumesForUser(user.id);
  return NextResponse.json({ resumes });
}

export async function POST(request: Request) {
  const user = await requireCurrentUser();
  const formData = await request.formData();
  const file = formData.get("resumeFile");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.redirect(new URL("/resumes?error=missing_file", request.url));
  }

  const parsed = resumeUploadInputSchema.safeParse({
    label: String(formData.get("label") ?? ""),
    baseText: String(formData.get("baseText") ?? ""),
    setAsDefault: String(formData.get("setAsDefault") ?? "").toLowerCase() === "on",
  });

  if (!parsed.success) {
    return NextResponse.redirect(new URL("/resumes?error=invalid_resume", request.url));
  }

  const upload = await saveUploadedResumeFile(file);
  await createResumeForUser(user.id, {
    ...parsed.data,
    originalFileName: file.name,
    mimeType: file.type || "application/octet-stream",
    storageKey: upload.storageKey,
  });

  return NextResponse.redirect(new URL("/resumes?uploaded=1", request.url));
}
