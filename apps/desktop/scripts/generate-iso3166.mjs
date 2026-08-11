/**
 * Regenerates `apps/desktop/src-tauri/data/iso3166.json`.
 *
 * DEV-ONLY. Run by a human, deliberately, as `pnpm --filter @nixus/desktop generate:iso3166`;
 * the produced file is reviewed and committed. This script is never wired into `dev`, `build`,
 * `tauri build`, a `pre*`/`post*` hook, or CI, and the shipped app never fetches this data —
 * it is embedded at compile time via `include_str!`.
 *
 * Canonical source of record: the Debian `iso-codes` project, pinned to tag v4.20.1.
 *   - ISO 3166-1 (countries), English:      data/iso_3166-1.json  (field `name`, `alpha_2`, `alpha_3`)
 *   - ISO 3166-2 (subdivisions), English:   data/iso_3166-2.json  (fields `code`, `name`)
 *   - French for both:                      iso_3166-1/fr.po, iso_3166-2/fr.po (gettext catalogues)
 *
 * The `.po` catalogues key each translation by an extracted comment of the form
 * `#. Name for <CODE>` — alpha-3 for countries, the ISO 3166-2 code for subdivisions — so French
 * names are joined on the code, never on the English string.
 *
 * Two deliberate omissions, both in service of "never fabricate a French name":
 *   - `fuzzy`-flagged entries are dropped. A fuzzy gettext translation is a machine guess copied
 *     from a similar string, and in this catalogue they are frequently plain wrong (`BW-FR`
 *     "Francistown" carries msgstr "Francisco Morazán").
 *   - Empty `msgstr` values are dropped.
 * Both cases fall through to the required, guaranteed-non-empty `name_en`.
 *
 * No npm package may be added for this (NFR6): Node built-ins and the global `fetch` only.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ISO_CODES_REF = "v4.20.1";
const ISO_CODES_BASE = `https://salsa.debian.org/iso-codes-team/iso-codes/-/raw/${ISO_CODES_REF}`;

const SOURCE_LABEL =
  `Debian iso-codes ${ISO_CODES_REF} — ${ISO_CODES_BASE}/data/iso_3166-1.json, ` +
  `${ISO_CODES_BASE}/data/iso_3166-2.json, ` +
  `${ISO_CODES_BASE}/iso_3166-1/fr.po, ${ISO_CODES_BASE}/iso_3166-2/fr.po ` +
  `(French joined on the "#. Name for <CODE>" comment; fuzzy and empty msgstr dropped)`;

const GENERATED_BY =
  "apps/desktop/scripts/generate-iso3166.mjs — dev-only; run `pnpm --filter @nixus/desktop generate:iso3166`. " +
  "Never fetched at runtime, never wired into build or CI.";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(SCRIPT_DIR, "../src-tauri/data/iso3166.json");

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}`);
  }
  return response.text();
}

/** gettext string literals are C-escaped and may be split across continuation lines. */
function unescapePoString(line) {
  const quoted = line.match(/"((?:[^"\\]|\\.)*)"/);
  if (quoted === null) return "";
  return quoted[1]
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

/**
 * Parses a gettext catalogue into `Map<code, frenchName>`, keyed by the `#. Name for <CODE>`
 * extracted comment. Entries that are fuzzy, untranslated, or carry no such comment are skipped.
 *
 * One comment line can carry several comma-separated roles for several codes — msgstr sharing
 * merges them, as in `#. Name for HUN, Official name for HUN`. Only the bare `Name for` role is
 * taken (`Official name for` and `Common name for` are longer variants, not display names), and
 * every code claiming that role in a block receives the block's msgstr.
 */
function parsePoNameCatalogue(po) {
  const translations = new Map();

  let codes = [];
  let fuzzy = false;
  let target = null;
  let msgstr = "";

  const flush = () => {
    const trimmed = msgstr.trim();
    if (!fuzzy && trimmed !== "") {
      for (const code of codes) translations.set(code, trimmed);
    }
    codes = [];
    fuzzy = false;
    target = null;
    msgstr = "";
  };

  for (const raw of po.split("\n")) {
    const line = raw.trimEnd();

    if (line === "") {
      flush();
      continue;
    }

    if (line.startsWith("#.")) {
      for (const part of line.slice(2).split(",")) {
        const nameFor = part.trim().match(/^Name for (\S+)$/);
        if (nameFor !== null) codes.push(nameFor[1]);
      }
      continue;
    }

    if (line.startsWith("#,")) {
      if (line.includes("fuzzy")) fuzzy = true;
      continue;
    }

    // `#|` previous-msgid comments and every other comment class are metadata only.
    if (line.startsWith("#")) continue;

    if (line.startsWith("msgid ")) {
      target = "msgid";
      continue;
    }

    if (line.startsWith("msgstr ")) {
      target = "msgstr";
      msgstr = unescapePoString(line);
      continue;
    }

    if (line.startsWith('"') && target === "msgstr") {
      msgstr += unescapePoString(line);
    }
  }

  flush();
  return translations;
}

function requireName(kind, code, name) {
  const trimmed = typeof name === "string" ? name.trim() : "";
  if (trimmed === "") {
    throw new Error(
      `${kind} ${code ?? "<no code>"} has no usable English name; refusing to write a dataset ` +
        `with a blank name_en (a blank option can never render in the UI).`,
    );
  }
  return trimmed;
}

function withOptionalFrench(entry, french) {
  const trimmed = typeof french === "string" ? french.trim() : "";
  // Omitted entirely rather than null or "": absent has exactly one representation, and the Rust
  // side deserialises a missing key straight to `None`.
  return trimmed === "" ? entry : { ...entry, name_fr: trimmed };
}

async function main() {
  const [countriesRaw, subdivisionsRaw, countriesFrPo, subdivisionsFrPo] =
    await Promise.all([
      fetchText(`${ISO_CODES_BASE}/data/iso_3166-1.json`),
      fetchText(`${ISO_CODES_BASE}/data/iso_3166-2.json`),
      fetchText(`${ISO_CODES_BASE}/iso_3166-1/fr.po`),
      fetchText(`${ISO_CODES_BASE}/iso_3166-2/fr.po`),
    ]);

  const iso1 = JSON.parse(countriesRaw)["3166-1"];
  const iso2 = JSON.parse(subdivisionsRaw)["3166-2"];
  if (!Array.isArray(iso1) || iso1.length === 0) {
    throw new Error("iso_3166-1.json did not contain a non-empty `3166-1` array");
  }
  if (!Array.isArray(iso2) || iso2.length === 0) {
    throw new Error("iso_3166-2.json did not contain a non-empty `3166-2` array");
  }

  const countryFr = parsePoNameCatalogue(countriesFrPo);
  const subdivisionFr = parsePoNameCatalogue(subdivisionsFrPo);

  const alpha2 = new Set();
  const countries = [];
  for (const entry of iso1) {
    const code = typeof entry.alpha_2 === "string" ? entry.alpha_2.trim() : "";
    if (!/^[A-Z]{2}$/.test(code)) {
      throw new Error(`iso_3166-1 entry has a non alpha-2 code: ${JSON.stringify(entry)}`);
    }
    if (alpha2.has(code)) {
      throw new Error(`iso_3166-1 contains duplicate alpha-2 code ${code}`);
    }
    alpha2.add(code);

    countries.push(
      withOptionalFrench(
        { code, name_en: requireName("Country", code, entry.name) },
        countryFr.get(entry.alpha_3),
      ),
    );
  }

  const byCountry = new Map();
  for (const entry of iso2) {
    const code = typeof entry.code === "string" ? entry.code.trim() : "";
    const parent = code.slice(0, 2);
    if (!/^[A-Z]{2}-\S+$/.test(code)) {
      throw new Error(`iso_3166-2 entry has a malformed code: ${JSON.stringify(entry)}`);
    }
    if (!alpha2.has(parent)) {
      throw new Error(
        `iso_3166-2 subdivision ${code} names country ${parent}, which is absent from iso_3166-1`,
      );
    }

    const subdivision = withOptionalFrench(
      { code, name_en: requireName("Subdivision", code, entry.name) },
      subdivisionFr.get(code),
    );

    const siblings = byCountry.get(parent);
    if (siblings === undefined) {
      byCountry.set(parent, [subdivision]);
    } else {
      siblings.push(subdivision);
    }
  }

  // Ascending by code, countries and subdivisions alike: stable ordering is what makes a
  // regeneration a reviewable line diff instead of a reshuffle. Display ordering is the UI's job.
  countries.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const withSubdivisions = countries.map((country) => {
    const subdivisions = byCountry.get(country.code);
    if (subdivisions === undefined) return country;
    subdivisions.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
    return { ...country, subdivisions };
  });

  const dataset = {
    _source: SOURCE_LABEL,
    _source_retrieved_at: new Date().toISOString().slice(0, 10),
    _generated_by: GENERATED_BY,
    countries: withSubdivisions,
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

  const subdivisionCount = withSubdivisions.reduce(
    (total, country) => total + (country.subdivisions?.length ?? 0),
    0,
  );
  const countriesWithFr = withSubdivisions.filter((c) => c.name_fr !== undefined).length;
  const subdivisionsWithFr = withSubdivisions.reduce(
    (total, country) =>
      total + (country.subdivisions ?? []).filter((s) => s.name_fr !== undefined).length,
    0,
  );
  const pct = (part, whole) => (whole === 0 ? "0.0" : ((part / whole) * 100).toFixed(1));

  process.stdout.write(
    [
      `Wrote ${OUTPUT_PATH}`,
      `  countries:        ${withSubdivisions.length} (name_fr on ${countriesWithFr}, ${pct(countriesWithFr, withSubdivisions.length)}%)`,
      `  subdivisions:     ${subdivisionCount} (name_fr on ${subdivisionsWithFr}, ${pct(subdivisionsWithFr, subdivisionCount)}%)`,
      `  source:           Debian iso-codes ${ISO_CODES_REF}`,
      "",
    ].join("\n"),
  );
}

main().catch((error) => {
  process.stderr.write(`generate-iso3166 failed: ${error.message}\n`);
  process.exitCode = 1;
});
