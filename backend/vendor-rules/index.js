'use strict';
 
/**
 * Vendor Rules Registry
 * ─────────────────────
 * Each vendor file exports:
 *   matchers   — [{ match, name, type }]  identifies vendor from sender email
 *   type       — string key e.g. "railfood"
 *   rule       — AI prompt text (used for text/plain vendors OR as DOM fallback)
 *   domConfig  — (optional) present ONLY on text/html vendors
 *                When present, DOM parsing is used instead of AI — no rule needed at runtime.
 *                rule is still kept as a safety fallback in case HTML part is missing.
 *
 * HOW THE ENGINE DECIDES WHICH PATH TO USE  (in backend.js processEmail):
 *   text/html vendor  →  domConfig exists  →  DOM parse (cheerio, 100% accurate)
 *                         DOM returns null  →  fall back to AI rule
 *   text/plain vendor →  no domConfig      →  AI rule only (unchanged behaviour)
 *
 * TO ADD A NEW text/html VENDOR:
 *   1. Add domConfig to that vendor's file (see railfood.js as the reference)
 *   2. require() + add to vendors array — nothing else needed
 *
 * TO ADD A NEW text/plain VENDOR:
 *   1. Create vendor file with matchers + type + rule only (no domConfig)
 *   2. require() + add to vendors array — nothing else needed
 *
 * ORDER MATTERS — more specific match strings before shorter ones
 * (e.g. "zoopindia" before "zoop").
 */

const railfood    = require('./railfood');
const zoop        = require('./zoop');
const rajbhog     = require('./rajbhog');
const yatribhojan = require('./yatribhojan');
const irctc       = require('./irctc');
const generic     = require('./generic');

const vendors = [
  railfood,
  zoop,
  rajbhog,
  yatribhojan,
  irctc,
  generic,
];

/**
 * VENDOR_MAP
 * Flat array of { match, name, type }.
 * First match wins — order preserved from vendors array above.
 */
const VENDOR_MAP = vendors.flatMap(v => v.matchers || []);

/**
 * VENDOR_RULES
 * Keyed by vendor type → AI prompt string.
 * Used by AI path for text/plain vendors and as DOM fallback.
 */
const VENDOR_RULES = Object.fromEntries(
  vendors
    .filter(v => v.type && v.rule)
    .map(v => [v.type, v.rule])
);

/**
 * VENDOR_DOM_CONFIGS
 * Keyed by vendor type → domConfig object.
 * Only vendors that export domConfig appear here (text/html vendors only).
 * Built automatically — no manual registration needed.
 */
const VENDOR_DOM_CONFIGS = Object.fromEntries(
  vendors
    .filter(v => v.type && v.domConfig)
    .map(v => [v.type, v.domConfig])
);

/**
 * VENDOR_SKIP_SUBJECTS
 * Keyed by vendor type → array of subject strings.
 * If an email's subject contains any of these strings, it is skipped silently.
 */
const VENDOR_SKIP_SUBJECTS = Object.fromEntries(
  vendors
    .filter(v => v.type && v.skipSubjects && v.skipSubjects.length > 0)
    .map(v => [v.type, v.skipSubjects.map(s => s.toLowerCase())])
);

module.exports = { VENDOR_MAP, VENDOR_RULES, VENDOR_DOM_CONFIGS, VENDOR_SKIP_SUBJECTS };
