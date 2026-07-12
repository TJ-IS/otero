import { JOURNAL_WHITELIST } from './journalWhitelist.js';

/**
 * Infer AIS Basket journal from a DOI string when library metadata is absent.
 * Heuristics cover common Elsevier / Wiley / INFORMS / SAGE / Palgrave / JAIS /
 * MISQ / JMIS patterns used by the Basket titles. Returns null when unknown.
 */
export function inferJournalFromDoi(doi) {
  if (!doi) return null;
  const d = String(doi).trim().toLowerCase();

  // Journal of Information Technology
  if (
    d.startsWith('10.1177/02683962')
    || d.includes('10.1080/0268396')
    || d.includes('/0268-3962')
    || d.includes('10.1057/jit.')
    || d.includes('10.1057/palgrave.jit')
    || d.includes('10.1057/s41265')
  ) {
    return 'Journal of Information Technology';
  }

  // European Journal of Information Systems
  if (
    d.includes('0960085x')
    || d.includes('10.1057/ejis.')
    || d.includes('10.1057/palgrave.ejis')
    || d.includes('10.1057/s41303')
    || d.includes('10.1038/sj.ejis')
  ) {
    return 'European Journal of Information Systems';
  }

  // Information Systems Journal
  if (
    d.includes('10.1111/isj')
    || d.includes('/isj.')
    || d.includes('10.1111/j.1365-2575')
    || d.includes('10.1046/j.1365-2575')
  ) {
    return 'Information Systems Journal';
  }

  // Information Systems Research
  if (d.includes('10.1287/isre') || d.includes('/isre.')) {
    return 'Information Systems Research';
  }

  // Journal of the Association for Information Systems
  if (d.includes('10.17705/1jais') || d.includes('jais.')) {
    return 'Journal of the Association for Information Systems';
  }

  // Journal of Management Information Systems (before broader MISQ checks)
  if (
    d.includes('10.1080/07421222')
    || d.includes('0742-1222')
    || d.includes('10.2753/mis0742')
  ) {
    return 'Journal of Management Information Systems';
  }

  // MIS Quarterly
  if (d.includes('10.25300/misq') || d.includes('/misq/')) {
    return 'MIS Quarterly';
  }

  // The Journal of Strategic Information Systems
  if (d.includes('/j.jsis.') || d.includes('0963-8687')) {
    return 'The Journal of Strategic Information Systems';
  }

  // Information and Organization
  if (d.includes('/j.infoandorg.') || d.includes('1471-7727')) {
    return 'Information and Organization';
  }

  // Information & Management (before DSS — both Elsevier)
  if (d.includes('/j.im.') || d.includes('0378-7206')) {
    return 'Information & Management';
  }

  // Decision Support Systems
  if (d.includes('/j.dss.') || d.includes('/0167-9236') || d.includes('s0167-9236')) {
    return 'Decision Support Systems';
  }

  return null;
}

/**
 * Best-effort year extraction from DOI suffixes (Elsevier / Taylor / MISQ / ISR / Palgrave).
 * Returns null when the DOI carries no reliable year token.
 */
export function inferYearFromDoi(doi) {
  if (!doi) return null;
  const d = String(doi).trim().toLowerCase();
  const patterns = [
    /\/j\.[a-z]+\.((?:19|20)\d{2})\.\d/i,     // 10.1016/j.im.2026.104322
    /0960085x\.((?:19|20)\d{2})\./i,          // EJIS T&F
    /07421222\.((?:19|20)\d{2})\./i,          // JMIS T&F
    /\/misq\/((?:19|20)\d{2})\//i,            // 10.25300/MISQ/2025/…
    /\/isre\.((?:19|20)\d{2})\./i,            // 10.1287/isre.2022.0484
    /\/(?:jit|ejis)\.((?:19|20)\d{2})\./i,    // 10.1057/jit.2015.26
    /\/s0167-9236\(((?:19|20)\d{2})\)/i,     // rare year-in-parens
  ];
  const maxY = new Date().getFullYear() + 1;
  for (const re of patterns) {
    const m = d.match(re);
    if (!m) continue;
    const y = Number(m[1]);
    if (y >= 1990 && y <= maxY) return y;
  }
  return null;
}

/** Stable Basket journal order for charts/tables. */
export function basketJournalOrder() {
  return [...JOURNAL_WHITELIST];
}
