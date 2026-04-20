"""
scheduler.py - Long-running loop that executes the pipeline every N hours.
"""
from __future__ import annotations

import asyncio
import logging
import sys
import time

import config
from main import main as run_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(message)s",
    datefmt="%H:%M:%S",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


async def run_forever() -> None:
    interval_seconds = max(1, config.SCHEDULER_INTERVAL_HOURS) * 3600
    logger.info(
        "[Scheduler] Starting recurring pipeline loop every %d hour(s).",
        config.SCHEDULER_INTERVAL_HOURS,
    )

    while True:
        started = time.monotonic()
        try:
            await run_pipeline()
        except Exception:
            logger.exception("[Scheduler] Pipeline cycle crashed")

        elapsed = time.monotonic() - started
        sleep_seconds = max(0, interval_seconds - int(elapsed))
        logger.info(
            "[Scheduler] Cycle finished in %ds. Sleeping for %ds.",
            int(elapsed),
            sleep_seconds,
        )
        await asyncio.sleep(sleep_seconds)


if __name__ == "__main__":
    asyncio.run(run_forever())
