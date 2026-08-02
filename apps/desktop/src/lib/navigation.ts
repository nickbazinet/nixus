/**
 * The Finance information architecture.
 *
 * Ten tabs collapse to four destinations. This is not an invention: `InnerTabNav` already grouped
 * the ten into four divider-separated clusters, so the correct structure was already discovered —
 * it was just expressed as visual grouping instead of navigation, which meant the user still paid a
 * ten-item scan cost. Cluster membership is unchanged.
 *
 * Architecture rule D8 is binding: no fifth destination, ever. New capability nests inside an
 * existing destination as a sub-surface. The 4-tuple type below makes a fifth a compile error
 * rather than a code-review question.
 */

interface SubSurface {
  to: string;
  labelKey: string;
}

interface Destination {
  to: string;
  labelKey: string;
  /** Today matches only `/`; the others own their whole subtree. */
  exact?: boolean;
  /** Max five, per the segmented sub-nav rule. */
  children: readonly SubSurface[];
}

type FourDestinations = readonly [Destination, Destination, Destination, Destination];

export const DESTINATIONS = [
  { to: "/", labelKey: "nav.today", exact: true, children: [] },
  {
    to: "/spending",
    exact: false,
    labelKey: "nav.spending",
    children: [
      { to: "/spending/budget", labelKey: "nav.budget" },
      { to: "/spending/transactions", labelKey: "nav.transactions" },
      { to: "/spending/income", labelKey: "nav.income" },
      { to: "/spending/recurring", labelKey: "nav.recurring" },
    ],
  },
  {
    to: "/wealth",
    exact: false,
    labelKey: "nav.wealth",
    children: [
      { to: "/wealth/accounts", labelKey: "nav.accounts" },
      { to: "/wealth/assets", labelKey: "nav.whatYouOwn" },
      { to: "/wealth/net-worth", labelKey: "nav.netWorth" },
      {
        to: "/wealth/where-to-put-your-money",
        labelKey: "nav.whereToPutYourMoney",
      },
    ],
  },
  {
    to: "/insights",
    exact: false,
    labelKey: "nav.insights",
    children: [
      { to: "/insights/trends", labelKey: "nav.trends" },
      { to: "/insights/year-summary", labelKey: "nav.yearSummary" },
      { to: "/insights/projection", labelKey: "nav.projection" },
    ],
  },
] as const satisfies FourDestinations;

/** Destinations whose surfaces read the global period. Wealth is a point-in-time picture. */
export const PERIOD_AWARE_DESTINATIONS = ["/", "/spending", "/insights"] as const;

export function isDestinationActive(
  destination: (typeof DESTINATIONS)[number],
  pathname: string
): boolean {
  if (destination.exact) return pathname === destination.to;
  return (
    pathname === destination.to || pathname.startsWith(`${destination.to}/`)
  );
}

export function findDestination(pathname: string) {
  return DESTINATIONS.find((destination) =>
    isDestinationActive(destination, pathname)
  );
}

export type { Destination, SubSurface };
