#!/usr/bin/env node
// Fails when translations are incomplete:
// 1. every locales/<lang>.json has exactly the keys of locales/en.json;
// 2. every translation object ({ "en": ..., "nl": ... }) in the compose files and
//    widget/driver compose JSON has every language that has a locales/ file.
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const localesDir = join(root, "locales");
const problems = [];

const langs = readdirSync(localesDir)
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5))
  .sort();

if (!langs.includes("en")) {
  console.error("locales/en.json is missing");
  process.exit(1);
}

function flatten(obj, prefix = "") {
  return Object.entries(obj).flatMap(([k, v]) =>
    v && typeof v === "object" && !Array.isArray(v) ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`],
  );
}

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"));
const enKeys = new Set(flatten(readJson(join(localesDir, "en.json"))));

for (const lang of langs.filter((l) => l !== "en")) {
  const keys = new Set(flatten(readJson(join(localesDir, `${lang}.json`))));
  for (const k of enKeys) if (!keys.has(k)) problems.push(`locales/${lang}.json: missing "${k}"`);
  for (const k of keys) if (!enKeys.has(k)) problems.push(`locales/${lang}.json: extra "${k}" (not in en.json)`);
}

const LANG_CODE = /^[a-z]{2}$/;
function isTranslationObject(v) {
  if (!v || typeof v !== "object" || Array.isArray(v) || typeof v.en !== "string") return false;
  return Object.keys(v).every((k) => LANG_CODE.test(k));
}

const composeLangs = new Set();
function walk(value, path, file) {
  if (isTranslationObject(value)) {
    for (const k of Object.keys(value)) composeLangs.add(k);
    const missing = langs.filter((l) => typeof value[l] !== "string" || value[l].trim() === "");
    if (missing.length) problems.push(`${file}: ${path || "(root)"} missing ${missing.join(", ")}`);
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walk(v, path ? `${path}.${k}` : k, file);
  }
}

function composeFiles(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return composeFiles(full);
    return name.endsWith(".json") ? [full] : [];
  });
}

const targets = [
  ...composeFiles(join(root, ".homeycompose")),
  ...composeFiles(join(root, "drivers")).filter((f) => /\.compose\.json$/.test(f)),
  ...composeFiles(join(root, "widgets")).filter((f) => /\.compose\.json$/.test(f)),
];
for (const file of targets) walk(readJson(file), "", relative(root, file));

if (existsSync(join(root, ".homeychangelog.json"))) {
  const changelog = readJson(join(root, ".homeychangelog.json"));
  const latest = Object.keys(changelog).sort((a, b) =>
    b.localeCompare(a, undefined, { numeric: true }),
  )[0];
  if (latest) walk(changelog[latest], latest, ".homeychangelog.json");
}

for (const lang of composeLangs) {
  if (!langs.includes(lang)) problems.push(`compose files use "${lang}" but locales/${lang}.json is missing`);
}

if (problems.length) {
  console.error(`Translation problems (languages: ${langs.join(", ")}):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`Translations complete for ${langs.join(", ")} (${targets.length} compose files checked).`);
