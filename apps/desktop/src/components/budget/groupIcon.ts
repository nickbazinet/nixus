import {
  Car,
  ChartNoAxesColumn,
  Folder,
  House,
  PiggyBank,
  Repeat,
  Shield,
  ShoppingBasket,
  Tag,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";

/**
 * A budget group's icon, guessed from its name. Groups carry no icon of their own, and a row of
 * identical tiles is exactly the noise the charte's icon chips exist to remove — so common English
 * and French group names get a fitting line icon, and anything else gets a neutral folder.
 * Purely decorative: the group name beside it is what identifies the group.
 */
const RULES: readonly [RegExp, LucideIcon][] = [
  [/hous|home|rent|mortgage|logement|maison|habitation|loyer|hypoth/i, House],
  [/food|grocer|dining|restaurant|meal|aliment|nourriture|[ée]picerie|repas/i, UtensilsCrossed],
  [/transport|car\b|auto|vehicle|voiture|v[ée]hicule|essence|gas\b/i, Car],
  [/bill|subscri|utilit|phone|internet|facture|abonnement|t[ée]l[ée]phone/i, Repeat],
  [/health|wellness|giving|charit|insur|sant[ée]|bien-[êe]tre|don|assurance/i, Shield],
  [/saving|goal|project|future|[ée]pargne|objectif|projet|avenir/i, PiggyBank],
  [/everyday|daily|quotidien|courant/i, ShoppingBasket],
  [/lifestyle|fun|leisure|entertain|shopping|loisir|divertissement|style de vie/i, Tag],
  [/else|other|misc|autre|divers/i, ChartNoAxesColumn],
];

export function groupIcon(name: string): LucideIcon {
  return RULES.find(([pattern]) => pattern.test(name))?.[1] ?? Folder;
}
