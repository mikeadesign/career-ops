// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */

// Accenture careers provider — POSTs to the same endpoint the
// accenture.com/{site}/careers/jobsearch UI calls. The body is multipart
// form data (not JSON), and the API expects a `CSRF-Token` header even though
// its value is empty. No cookies or browser session are needed.
//
// Configure via a `job_boards` (or `tracked_companies`) entry with
// `provider: accenture` and an optional `accenture:` block:
//
//   - name: Accenture — US
//     provider: accenture
//     accenture:
//       country: USA          # jobCountry (default USA)
//       site: us-en           # countrySite / URL locale (default us-en)
//       keywords: ["engineering manager", "director"]   # optional; one query each
//     enabled: true
//
// The API's vector search ranks loosely, so keywords only steer the result
// set — scan.mjs's title_filter is what actually narrows it. Omit `keywords`
// to page through every posting for the country.

const API_URL = 'https://www.accenture.com/api/accenture/elastic/findjobs';
const PAGE_SIZE = 50;
const MAX_RECORDS = 1500; // safety cap on pagination, per keyword
const TIMEOUT_MS = 30_000;

/**
 * Builds the multipart form the search endpoint expects.
 * @param {{ country: string, site: string, keyword: string, startIndex: number }} p
 */
export function buildForm({ country, site, keyword, startIndex }) {
  const fields = {
    startIndex: String(startIndex),
    maxResultSize: String(PAGE_SIZE),
    jobKeyword: keyword,
    jobCountry: country,
    jobLanguage: 'en',
    countrySite: site,
    sortBy: '1',
    searchType: 'vectorSearch',
    enableQueryBoost: 'true',
    minScore: '0.6',
    getFeedbackJudgmentEnabled: 'true',
    useCleanEmbedding: 'true',
    score: 'true',
    totalHits: 'true',
    debugQuery: 'false',
    jobFilters: '[]',
  };
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return form;
}

/**
 * Normalizes one page of the API response into job entries. Throws if the
 * response lacks `data[]`, so a silent endpoint change surfaces as a hard
 * error instead of empty results.
 * @param {any} json - A single API response page.
 * @param {string} site - Locale substituted for the `{0}` in jobDetailUrl.
 * @returns {Array<{title: string, url: string, company: string, location: string, description?: string}>}
 */
export function parseAccentureResponse(json, site) {
  if (!json || !Array.isArray(json.data)) {
    throw new Error(`accenture: unexpected API response — expected data[], got keys: [${json ? Object.keys(json).join(', ') : 'null'}]`);
  }

  const out = [];
  for (const j of json.data) {
    if (!j || typeof j.title !== 'string' || j.title.trim() === '') continue;
    if (typeof j.jobDetailUrl !== 'string') continue;
    const url = j.jobDetailUrl.replace('{0}', site).trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const loc = Array.isArray(j.location) ? j.location.filter(Boolean).join(', ') : typeof j.location === 'string' ? j.location.trim() : '';
    const remote = typeof j.remoteType === 'string' ? j.remoteType.trim() : '';
    /** @type {{title: string, url: string, company: string, location: string, description?: string}} */
    const job = {
      title: j.title.trim(),
      url,
      company: 'Accenture',
      location: [loc, remote].filter(Boolean).join(' · '),
    };
    if (typeof j.jobDescriptionClean === 'string' && j.jobDescriptionClean.trim()) {
      job.description = j.jobDescriptionClean.trim();
    }
    out.push(job);
  }
  return out;
}

/** @type {Provider} */
export default {
  id: 'accenture',

  /**
   * Fetches and normalizes postings from Accenture's careers search API.
   * @param {{ name?: string, accenture?: { country?: string, site?: string, keywords?: string[] } }} entry
   * @param {{ fetchJson: (url: string, opts?: object) => Promise<any> }} ctx
   */
  async fetch(entry, ctx) {
    const cfg = entry.accenture || {};
    const country = typeof cfg.country === 'string' && cfg.country.trim() ? cfg.country.trim() : 'USA';
    const site = typeof cfg.site === 'string' && cfg.site.trim() ? cfg.site.trim() : 'us-en';
    const keywords = Array.isArray(cfg.keywords)
      ? cfg.keywords.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim())
      : [];
    if (!keywords.length) keywords.push('');

    /** @type {Map<string, any>} */
    const byUrl = new Map();

    for (const keyword of keywords) {
      for (let startIndex = 0; startIndex < MAX_RECORDS; startIndex += PAGE_SIZE) {
        // No content-type header: fetch sets the multipart boundary itself.
        // redirect:'error' prevents SSRF via server-side redirects.
        const json = await ctx.fetchJson(API_URL, {
          method: 'POST',
          headers: {
            accept: 'application/json',
            'csrf-token': '',
            referer: `https://www.accenture.com/${site}/careers/jobsearch`,
          },
          body: buildForm({ country, site, keyword, startIndex }),
          redirect: 'error',
          timeoutMs: TIMEOUT_MS,
        });

        const page = parseAccentureResponse(json, site);
        for (const job of page) if (!byUrl.has(job.url)) byUrl.set(job.url, job);

        const total = json.totalHits && typeof json.totalHits.total === 'number' ? json.totalHits.total : null;
        // Stop on an empty/short page, or once the reported total is covered.
        if (json.data.length < PAGE_SIZE) break;
        if (total !== null && startIndex + PAGE_SIZE >= total) break;
      }
    }

    return [...byUrl.values()];
  },
};
