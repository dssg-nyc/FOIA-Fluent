"""Shared transparency score computation used by all refresh scripts."""


def compute_transparency_score(
    success_rate: float,
    avg_response_time: float,
    fee_rate: float,
    has_portal: bool,
) -> float:
    """Compute a 0–100 transparency score.

    Weights:
      40% — success rate (higher = better)
      30% — response speed (faster = better; normalized against 120-day max)
      15% — fee rate (lower = better)
      15% — electronic portal availability
    """
    success_component = (success_rate or 0) / 100 * 40
    # Clamp negative response times to 0 (MuckRock data quirk)
    rt_normalized = max(0.0, 1.0 - min((max(avg_response_time or 0, 0) or 60) / 120.0, 1.0))
    speed_component = rt_normalized * 30
    fee_component = (1.0 - min((fee_rate or 0) / 100, 1.0)) * 15
    portal_component = 15.0 if has_portal else 0.0
    return round(success_component + speed_component + fee_component + portal_component, 2)
