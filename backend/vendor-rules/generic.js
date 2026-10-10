'use strict';

/**
 * VENDOR: GENERIC FALLBACK
 * Used when the sender does not match any known vendor.
 */

const matchers = []; // No email-pattern matchers — this is the fallback only

const type = 'generic';

const rule = `GENERAL RULES:
- Find items table. Extract Quantity from its own dedicated column ONLY.
- COACH: capture the FULL coach+seat value. If coach and seat are in separate fields, combine as "COACH/SEAT".
- VERIFY: Price × Quantity = Amount for each item.
- DATE: convert any date format to YYYY-MM-DD. Time to HH:MM 24hr.`;

module.exports = { matchers, type, rule };
