/**
 * Landing-page icon set (route "/" only).
 *
 * Hand-rolled inline SVG rather than a dependency, matching the geometry
 * the rest of the app already uses (24x24 grid, stroke-only, currentColor,
 * 1.75 weight — see the `iconProps` object in Sidebar.tsx). Stroke-only
 * keeps them light enough to sit beside the serif display type without
 * competing with it.
 *
 * Every icon inherits color from its parent, so feature icons pick up the
 * section's --spot accent for free.
 */

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.75,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: "false" as const,
};

type Props = { size?: number; className?: string };

const svg = (size: number, className: string | undefined, children: React.ReactNode) => (
  <svg {...base} width={size} height={size} className={className}>
    {children}
  </svg>
);

/* ── Feature icons ───────────────────────────────────────────────────── */

// Discover & Draft
export const IconSearch = ({ size = 18, className }: Props) =>
  svg(size, className, (
    <>
      <circle cx="11" cy="11" r="7" />
      <line x1="16.5" y1="16.5" x2="21" y2="21" />
    </>
  ));

// Track & Manage — a clock, for the statutory deadline
export const IconClock = ({ size = 18, className }: Props) =>
  svg(size, className, (
    <>
      <circle cx="12" cy="12" r="9" />
      <polyline points="12 6.5 12 12 15.5 14" />
    </>
  ));

// Transparency Hub — a civic building
export const IconInstitution = ({ size = 18, className }: Props) =>
  svg(size, className, (
    <>
      <polyline points="3 10 12 4 21 10" />
      <line x1="6.5" y1="10" x2="6.5" y2="17.5" />
      <line x1="10.5" y1="10" x2="10.5" y2="17.5" />
      <line x1="13.5" y1="10" x2="13.5" y2="17.5" />
      <line x1="17.5" y1="10" x2="17.5" y2="17.5" />
      <line x1="4" y1="20.5" x2="20" y2="20.5" />
    </>
  ));

// Live FOIA Signals — a broadcast
export const IconSignal = ({ size = 18, className }: Props) =>
  svg(size, className, (
    <>
      <circle cx="12" cy="12" r="2" />
      <path d="M8.6 15.4a4.8 4.8 0 0 1 0-6.8" />
      <path d="M15.4 8.6a4.8 4.8 0 0 1 0 6.8" />
      <path d="M5.8 18.2a8.8 8.8 0 0 1 0-12.4" />
      <path d="M18.2 5.8a8.8 8.8 0 0 1 0 12.4" />
    </>
  ));

/* ── Audience icons ──────────────────────────────────────────────────── */

export const IconNewspaper = ({ size = 20, className }: Props) =>
  svg(size, className, (
    <>
      <path d="M4 5h13v14H5.5A1.5 1.5 0 0 1 4 17.5z" />
      <path d="M17 9h3v8.5a1.5 1.5 0 0 1-3 0z" />
      <line x1="7" y1="9" x2="14" y2="9" />
      <line x1="7" y1="12.5" x2="14" y2="12.5" />
      <line x1="7" y1="16" x2="11" y2="16" />
    </>
  ));

export const IconScales = ({ size = 20, className }: Props) =>
  svg(size, className, (
    <>
      <line x1="12" y1="4" x2="12" y2="20" />
      <line x1="6" y1="20.5" x2="18" y2="20.5" />
      <line x1="4" y1="7.5" x2="20" y2="7.5" />
      <polyline points="1.8 13.5 4 7.8 6.2 13.5" />
      <path d="M1.8 13.5a2.2 2.2 0 0 0 4.4 0" />
      <polyline points="17.8 13.5 20 7.8 22.2 13.5" />
      <path d="M17.8 13.5a2.2 2.2 0 0 0 4.4 0" />
    </>
  ));

export const IconFlask = ({ size = 20, className }: Props) =>
  svg(size, className, (
    <>
      <path d="M9.5 3v6.2L4.8 18a1.6 1.6 0 0 0 1.4 2.4h11.6a1.6 1.6 0 0 0 1.4-2.4L14.5 9.2V3" />
      <line x1="8" y1="3" x2="16" y2="3" />
      <line x1="7.2" y1="14.5" x2="16.8" y2="14.5" />
    </>
  ));

export const IconUsers = ({ size = 20, className }: Props) =>
  svg(size, className, (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" />
      <path d="M17.5 14.2a5.5 5.5 0 0 1 3 4.8" />
    </>
  ));

/* ── Supporting-feature icons ────────────────────────────────────────── */

export const IconBookmark = ({ size = 18, className }: Props) =>
  svg(size, className, <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" />);

export const IconChat = ({ size = 18, className }: Props) =>
  svg(size, className, (
    <>
      <path d="M20.5 12.5a7.5 7.5 0 0 1-10.9 6.7L4 20.5l1.4-5.3A7.5 7.5 0 1 1 20.5 12.5z" />
      <line x1="9" y1="12" x2="15" y2="12" />
      <line x1="9" y1="15" x2="13" y2="15" />
    </>
  ));
