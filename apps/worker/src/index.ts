import { runPipeline } from "./pipeline";

async function main() {
  const result = await runPipeline();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error("[worker] fatal error", error);
  process.exit(1);
});
