import {
  BrainCircuit,
  FileUp,
  Gauge,
  Repeat2,
  type LucideIcon,
} from "lucide-react";

/**
 * The four product stages from `docs/business-vision.md` — Organize, Understand,
 * Guide, Automate — used as the homepage's narrative spine.
 *
 * They do double duty, which is why the ladder is the structure rather than a
 * flat feature grid: a visitor new to budgeting reads four plain questions in
 * the order they would actually ask them, while a visitor who already runs a
 * spreadsheet reads the product's thesis and can see which rung is built out.
 * A grid of eight equal cards communicates neither.
 *
 * `points` are capped at three. The stage headline makes the claim and the
 * screenshot proves it; a fourth bullet turns a showcase back into the spec
 * sheet this section replaced.
 *
 * Every image is 16:10 ON PURPOSE — see `SHOWCASE_ASPECT`. The first build of
 * this section used each screenshot at its native ratio, which ranged from 0.41
 * to 0.98, so the visual column's height swung by more than double between rows
 * and left dead space under the shorter text columns. Uniform framing is what
 * makes four alternating rows read as one rhythm instead of four accidents.
 */

/** The framing contract for every showcase screenshot: 1600 × 1000. */
export const SHOWCASE_ASPECT = "16 / 10" as const;

export type StageId = "organize" | "understand" | "guide" | "automate";

export type Stage = {
  readonly id: StageId;
  readonly icon: LucideIcon;
  readonly image: string;
  readonly pointIds: readonly string[];
};

export const stages: readonly Stage[] = [
  {
    id: "organize",
    icon: FileUp,
    image: "/product/stage-organize.png",
    pointIds: ["import", "accounts", "assets"],
  },
  {
    id: "understand",
    icon: Gauge,
    image: "/product/stage-understand.png",
    pointIds: ["budget", "cashflow", "netWorth"],
  },
  {
    id: "guide",
    icon: BrainCircuit,
    image: "/product/stage-guide.png",
    pointIds: ["health", "chat", "confirm"],
  },
  {
    id: "automate",
    icon: Repeat2,
    image: "/product/stage-automate.png",
    pointIds: ["recurring", "maintenance", "updates"],
  },
] as const;
