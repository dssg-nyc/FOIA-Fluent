"""Federal FOIA deadline calculation.

Computes the 20-business-day statutory deadline under 5 U.S.C. § 552(a)(6)(A),
skipping weekends and federal holidays.
"""
from datetime import date, timedelta
from typing import Optional

from app.models.tracking import DeadlineInfo, TrackedRequest

# Federal holidays 2025–2027 (fixed-date and observed)
FEDERAL_HOLIDAYS: set[date] = {
    # 2025
    date(2025, 1, 1),   # New Year's Day
    date(2025, 1, 20),  # MLK Day
    date(2025, 2, 17),  # Presidents' Day
    date(2025, 5, 26),  # Memorial Day
    date(2025, 6, 19),  # Juneteenth
    date(2025, 7, 4),   # Independence Day
    date(2025, 9, 1),   # Labor Day
    date(2025, 10, 13), # Columbus Day
    date(2025, 11, 11), # Veterans Day
    date(2025, 11, 27), # Thanksgiving
    date(2025, 12, 25), # Christmas
    # 2026
    date(2026, 1, 1),
    date(2026, 1, 19),
    date(2026, 2, 16),
    date(2026, 5, 25),
    date(2026, 6, 19),
    date(2026, 7, 3),   # July 4 observed (Friday)
    date(2026, 9, 7),
    date(2026, 10, 12),
    date(2026, 11, 11),
    date(2026, 11, 26),
    date(2026, 12, 25),
    # 2027
    date(2027, 1, 1),
    date(2027, 1, 18),
    date(2027, 2, 15),
    date(2027, 5, 31),
    date(2027, 6, 18),  # Juneteenth observed (Friday)
    date(2027, 7, 5),   # July 4 observed (Monday)
    date(2027, 9, 6),
    date(2027, 10, 11),
    date(2027, 11, 11),
    date(2027, 11, 25),
    date(2027, 12, 24), # Christmas observed (Friday)
}


def _is_business_day(d: date) -> bool:
    return d.weekday() < 5 and d not in FEDERAL_HOLIDAYS


def calculate_due_date(filed_date: date, business_days: int = 20) -> date:
    """Add `business_days` business days to `filed_date`."""
    current = filed_date
    count = 0
    while count < business_days:
        current += timedelta(days=1)
        if _is_business_day(current):
            count += 1
    return current


def _count_business_days_between(start: date, end: date) -> int:
    """Count business days from start (exclusive) to end (inclusive)."""
    count = 0
    current = start + timedelta(days=1)
    while current <= end:
        if _is_business_day(current):
            count += 1
        current += timedelta(days=1)
    return count


def get_deadline_info(request: TrackedRequest) -> Optional[DeadlineInfo]:
    """Return deadline info for a submitted request, or None if not yet filed."""
    if not request.filed_date:
        return None

    try:
        filed = date.fromisoformat(request.filed_date)
    except ValueError:
        return None

    due = calculate_due_date(filed)
    today = date.today()

    elapsed = _count_business_days_between(filed, min(today, due))
    remaining = max(0, _count_business_days_between(min(today, due), due))
    is_overdue = today > due

    if is_overdue:
        days_over = _count_business_days_between(due, today)
        label = f"OVERDUE by {days_over} business day{'s' if days_over != 1 else ''}"
    elif elapsed == 0:
        label = "Filed today — Day 0 of 20"
    else:
        label = f"Day {elapsed} of 20"

    return DeadlineInfo(
        request_id=request.id,
        filed_date=request.filed_date,
        due_date=due.isoformat(),
        business_days_elapsed=elapsed,
        business_days_remaining=remaining,
        is_overdue=is_overdue,
        status_label=label,
    )
