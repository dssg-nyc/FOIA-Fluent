export type Placement = "top" | "bottom" | "left" | "right" | "center";

/** A "follow" stage for interactive steps. When the engine sees the
 * `appear` selector in the DOM, the ring jumps onto it and the copy
 * swaps. `follow` can be a single stage or an array — an array chains
 * the stages, advancing one-at-a-time as each appears.
 *
 * `actionHint` is an optional, pulsing pill that surfaces the
 * imperative ("Click a theme bubble") above the progress bar while
 * we're waiting for this stage's `appear` selector. It disappears
 * once the user has completed the action. */
export type FollowStage = {
  appear: string;
  title?: string;
  body?: string;
  placement?: Placement;
  actionHint?: string;
};

/**
 * Step kinds:
 *  - "explain": dim + spotlight an element. Optional `scrollGate`: the step
 *    waits for the user to actually scroll to the bottom of the page (the copy
 *    swaps when they get there) so they read through everything before moving on.
 *  - "navigate": dim but click-through; point an arrow at a route link (a sidebar
 *    item or a Hub tab) and advance once the user lands on the destination.
 *  - "interactive": no dim, just a ring, so the user can click the highlighted
 *    thing in full color. Optional `follow`: a single stage or a chain — each
 *    stage waits for its `appear` selector, then jumps the ring and updates the
 *    copy. Used for multi-step interactions like galaxy theme → pattern → drawer.
 *  - "finale": centered card + confetti.
 */
export type TourStep =
  | {
      kind: "explain";
      id: string;
      route: string;
      target: string;
      title: string;
      body: string;
      placement: Placement;
      scrollGate?: boolean;
    }
  | { kind: "navigate"; id: string; gotoRoute: string; target: string; title: string; body: string; placement: Placement }
  | {
      kind: "interactive";
      id: string;
      route: string;
      target: string;
      title: string;
      body: string;
      placement: Placement;
      /** Pill rendered above the progress bar while the user hasn't
       * completed the initial action yet. Use this for the imperative
       * ("Click the bubble") so it stands apart from the body copy. */
      actionHint?: string;
      follow?: FollowStage | FollowStage[];
    }
  | { kind: "finale"; id: string; route: string; title: string; body: string };

export const TOUR_STEPS: TourStep[] = [
  {
    kind: "explain",
    id: "welcome",
    route: "/hub",
    target: ".sidebar",
    title: "Welcome to FOIA Fluent",
    body: "A quick tour to get you oriented.\n\nThe **left sidebar** is how you move around. Research, drafting, tracking, and live intelligence all live there.",
    placement: "right",
  },
  {
    kind: "explain",
    id: "hub-stats",
    route: "/hub",
    target: ".hub-stats-grid",
    title: "The Transparency Hub",
    body: "Every federal agency, benchmarked on FOIA performance.\n\nScroll through the outcome charts and agency rankings. We'll continue at the bottom.",
    placement: "bottom",
    scrollGate: true,
  },
  {
    kind: "navigate",
    id: "go-states",
    gotoRoute: "/hub/states",
    target: '.hub-tab[href="/hub/states"]',
    title: "State & Local",
    body: "The Hub isn't just federal. All 50 states are graded too.\n\nClick **State & Local** to see them.",
    placement: "bottom",
  },
  {
    kind: "explain",
    id: "states-map",
    route: "/hub/states",
    target: ".hub-stats-grid",
    title: "Every state, graded",
    body: "Same shape as the federal Hub, with a map colored by transparency score.\n\nScroll through the stats, the map, and the directory. We'll continue at the bottom.",
    placement: "top",
    scrollGate: true,
  },
  {
    kind: "navigate",
    id: "go-insights",
    gotoRoute: "/hub/insights",
    target: '.hub-tab[href="/hub/insights"]',
    title: "Insights",
    body: "Now for the long view.\n\nClick **Insights**.",
    placement: "bottom",
  },
  {
    kind: "explain",
    id: "insights-charts",
    route: "/hub/insights",
    target: ".hub-charts-row",
    title: "17 years of trends",
    body: "FOIA analytics from FOIA.gov, across all of government: request volume, processing times, costs, and appeals.\n\nScroll through the charts. We'll continue at the bottom.",
    placement: "top",
    scrollGate: true,
  },
  {
    kind: "navigate",
    id: "go-draft",
    gotoRoute: "/draft",
    target: '.sidebar-link[href="/draft"]',
    title: "Discover & Draft",
    body: "Now to the core workflow.\n\nClick **Discover & Draft** to find records and write requests.",
    placement: "right",
  },
  {
    kind: "explain",
    id: "draft",
    route: "/draft",
    target: ".search-textarea",
    title: "Search in plain English",
    body: "Describe what you need. We search MuckRock, DocumentCloud, and the open web.\n\nFrom any result you can **save the document**, **save the search**, or **draft a FOIA letter** grounded in statute and agency rules.",
    placement: "bottom",
  },
  {
    kind: "navigate",
    id: "go-dashboard",
    gotoRoute: "/dashboard",
    target: '.sidebar-link[href="/dashboard"]',
    title: "My Requests",
    body: "Where you track every request you file.\n\nClick **My Requests** to take a look.",
    placement: "right",
  },
  {
    kind: "explain",
    id: "dashboard",
    route: "/dashboard",
    target: '[data-tour="dashboard-page"]',
    title: "Track every request",
    body: "Filed requests live here with **automatic deadline tracking**.\n\nOpen any to see its communication timeline, AI analysis of the agency's response, and **appeal letters in seconds**.",
    placement: "right",
  },
  {
    kind: "navigate",
    id: "go-discoveries",
    gotoRoute: "/discoveries",
    target: '.sidebar-link[href="/discoveries"]',
    title: "My Discoveries",
    body: "Click **My Discoveries** to open your saved research library.",
    placement: "right",
  },
  {
    kind: "explain",
    id: "discoveries",
    route: "/discoveries",
    target: '[data-tour="discoveries-page"]',
    title: "Your research library",
    body: "Every document you save lands here.\n\n**Tag it**, **add notes**, and link a discovery to the request it supports.",
    placement: "right",
  },
  {
    kind: "navigate",
    id: "go-signals",
    gotoRoute: "/signals",
    target: '.sidebar-link[href="/signals"]',
    title: "Live FOIA Signals",
    body: "Click **Live FOIA Signals**.",
    placement: "right",
  },
  {
    kind: "interactive",
    id: "signals-galaxy",
    route: "/signals",
    target: ".pattern-theme-galaxy",
    title: "Explore a pattern",
    body: "A live galaxy of federal activity, clustered into themes by AI.",
    actionHint: "👉 Click any theme bubble to drill in",
    placement: "left",
    // Three-stage chain — the ring follows the user as they drill from
    // theme → pattern → drawer. Each stage waits for its `appear`
    // selector to land in the DOM, then swaps in the new copy.
    follow: [
      {
        appear: ".signals-galaxy-drilled",
        title: "Now pick a pattern",
        body: "Each bubble here is a pattern the AI found.",
        actionHint: "👉 Click one to see the full story",
        placement: "left",
      },
      {
        appear: ".signals-drawer",
        title: "There it is",
        body: "The pattern's narrative and the signals that triggered it slide out here.\n\nPress **Next** to keep going.",
        placement: "left",
      },
    ],
  },
  {
    kind: "interactive",
    id: "assistant",
    route: "/signals",
    target: ".chat-bubble",
    title: "Your AI assistant",
    body: "Last one. The assistant lives on every page. Hit **⌘K** anywhere to open it.\n\nIt helps with research, drafts, and appeals, and cites its sources.",
    actionHint: "👉 Click the bubble in the bottom right",
    placement: "left",
    follow: {
      appear: ".chat-panel",
      title: "Ask it anything",
      body: "Ask away. Every answer is grounded in cited sources.\n\nPress **Next** to finish the tour.",
      placement: "left",
    },
  },
  {
    kind: "finale",
    id: "finale",
    route: "/signals",
    title: "You're all set!",
    body: "Replay this anytime from the menu under your email in the sidebar.",
  },
];
