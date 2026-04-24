import { NextResponse } from "next/server";
import { z } from "zod";

import { requireOnboardedUser } from "@/lib/auth";
import { markWorkerRunning, setWorkerResult } from "@/lib/worker-state";

const bodySchema = z.object({
  board: z.string().min(1),
  source: z.enum(["greenhouse", "ashby", "lever", "workable", "mock"]),
});

export async function POST(request: Request) {
  const user = await requireOnboardedUser();
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  const { board, source } = parsed.data;
  markWorkerRunning();

  // Run in background — don't await so the response returns immediately
  runBoardInBackground(user.id, source, board);

  return NextResponse.json({ ok: true, board, source });
}

async function runBoardInBackground(
  userId: string,
  source: string,
  board: string,
) {
  try {
    const { runPipeline } = await import(
      "../../../../../../worker/src/pipeline"
    );
    const result = await runPipeline({
      onlyUserId: userId,
      boardFilter: { source, slug: board },
    });
    setWorkerResult(result);
  } catch (err) {
    setWorkerResult(null);
    console.error("[run-board] pipeline error:", err);
  }
}
