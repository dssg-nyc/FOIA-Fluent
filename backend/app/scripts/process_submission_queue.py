"""Cron entrypoint — picks up queued submission_runs at `sends_at` and fires
the channel handler. Run this every 60 seconds via Railway's scheduled
triggers.

Command: python -m app.scripts.process_submission_queue
"""
import logging
import sys

from app.services import submitter

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger("submission-queue")


def main() -> int:
    result = submitter.process_queue_tick()
    if result.get("error"):
        logger.error(f"queue tick error: {result['error']}")
        return 1
    logger.info(
        f"[queue] picked_up={result.get('picked_up', 0)} "
        f"succeeded={result.get('succeeded', 0)} "
        f"failed={result.get('failed', 0)}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
