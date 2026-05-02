/** Single source of truth for signal-source labels + colors.
 *
 * Lives in `lib/` rather than alongside the components so the constants can
 * be imported by both `SignalsDashboard.tsx` (which renders the live feed)
 * and `PatternGraph.tsx` (which renders detail-mode signal dots) without a
 * circular module dependency.
 *
 * Order in this file is also the order the dashboard's source-filter pills
 * render — group by family for visual grouping in the chip row.
 */

export const SOURCE_LABELS: Record<string, string> = {
  // Enforcement & oversight
  gao_protests:           "GAO Protests",
  epa_echo:               "EPA ECHO",
  fda_warning_letters:    "FDA Warnings",
  oversight_ig_reports:   "IG Reports",
  gao_reports:            "GAO Reports",
  osha_news:              "OSHA",
  irs_news:               "IRS",
  sec_press_releases:     "SEC",
  ftc_press_releases:     "FTC",
  fec_enforcement:        "FEC",
  // Recalls & safety
  fda_drug_recalls:       "Drug Recalls",
  fda_food_recalls:       "Food Recalls",
  fda_device_recalls:     "Device Recalls",
  cpsc_recalls:           "CPSC Recalls",
  nhtsa_recalls:          "NHTSA Recalls",
  // Courts & legal
  courtlistener_opinions: "Court Opinions",
  // Research & policy
  dhs_foia_log:           "DHS FOIA",
  congress_gov:           "Congress.gov",
  regulations_gov:        "Reg Dockets",
};

/** Long-form labels for badges in detail panes / drawers / cards where we
 * have more horizontal room than the dashboard's filter chips. */
export const SOURCE_LONG_LABELS: Record<string, string> = {
  gao_protests:           "GAO Bid Protest Decision",
  epa_echo:               "EPA ECHO Enforcement",
  fda_warning_letters:    "FDA Warning Letter",
  oversight_ig_reports:   "Inspector General Report",
  gao_reports:            "GAO Audit / Evaluation",
  osha_news:              "OSHA Enforcement News",
  irs_news:               "IRS News Release",
  sec_press_releases:     "SEC Press Release",
  ftc_press_releases:     "FTC Press Release",
  fec_enforcement:        "FEC Enforcement Matter",
  fda_drug_recalls:       "FDA Drug Recall",
  fda_food_recalls:       "FDA Food / Cosmetic Recall",
  fda_device_recalls:     "FDA Medical Device Recall",
  cpsc_recalls:           "CPSC Product Recall",
  nhtsa_recalls:          "NHTSA Vehicle Recall",
  courtlistener_opinions: "Federal Court Opinion",
  dhs_foia_log:           "DHS FOIA Log Entry",
  congress_gov:           "Congress.gov Bill",
  regulations_gov:        "Regulations.gov Docket",
};

/** Per-source dot color. Clustered by family (enforcement = blues, recalls
 * = warm reds/oranges, courts = purple, research = greens) so the filter
 * row visually groups itself. */
export const SOURCE_COLORS: Record<string, string> = {
  // Enforcement (blues)
  gao_protests:           "#2b66c9",
  epa_echo:               "#1f8562",
  fda_warning_letters:    "#6d4fc0",
  oversight_ig_reports:   "#3a7fc1",
  gao_reports:            "#4a8fd5",
  osha_news:              "#0f6e8c",
  irs_news:               "#5575b8",
  sec_press_releases:     "#1d4ed8",
  ftc_press_releases:     "#3651a8",
  fec_enforcement:        "#5b6dad",
  // Recalls (warm reds/oranges)
  fda_drug_recalls:       "#c0392b",
  fda_food_recalls:       "#d35400",
  fda_device_recalls:     "#a93226",
  cpsc_recalls:           "#c17a2a",
  nhtsa_recalls:          "#a04020",
  // Courts (purple)
  courtlistener_opinions: "#7d3c98",
  // Research (greens)
  dhs_foia_log:           "#1f8562",
  congress_gov:           "#5d8a3e",
  regulations_gov:        "#2c8c4f",
};

export const ALL_SOURCES: string[] = [
  // Enforcement & oversight
  "gao_protests", "epa_echo", "fda_warning_letters", "oversight_ig_reports",
  "gao_reports", "osha_news", "irs_news", "sec_press_releases",
  "ftc_press_releases", "fec_enforcement",
  // Recalls
  "fda_drug_recalls", "fda_food_recalls", "fda_device_recalls",
  "cpsc_recalls", "nhtsa_recalls",
  // Courts
  "courtlistener_opinions",
  // Research
  "dhs_foia_log", "congress_gov", "regulations_gov",
];

/** Sources whose signals represent a FOIA REQUEST being filed (someone
 * asking the agency for records) rather than an AGENCY ACTION (the agency
 * doing something on its own). Used by feed cards to render the right
 * verb badge ("FOIA request filed" vs "Agency action"). */
export const FOIA_REQUEST_SOURCES = new Set(["dhs_foia_log"]);
export function signalKind(source: string): "request" | "action" {
  return FOIA_REQUEST_SOURCES.has(source) ? "request" : "action";
}
