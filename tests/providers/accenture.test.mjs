// tests/providers/accenture.test.mjs — auto-discovered by test-all.mjs.
import { pass, fail, ROOT } from '../helpers.mjs';
import { join } from 'path';
import { pathToFileURL } from 'url';

console.log('\nProvider — accenture');

try {
  const mod = await import(pathToFileURL(join(ROOT, 'providers/accenture.mjs')).href);
  const accenture = mod.default;
  const { parseAccentureResponse, buildForm } = mod;

  if (accenture.id === 'accenture') pass('accenture.id is "accenture"');
  else fail(`accenture.id is ${JSON.stringify(accenture.id)}`);

  // buildForm — multipart fields the endpoint requires
  const form = buildForm({ country: 'USA', site: 'us-en', keyword: 'manager', startIndex: 50 });
  if (form instanceof FormData && form.get('startIndex') === '50' && form.get('jobCountry') === 'USA'
      && form.get('countrySite') === 'us-en' && form.get('jobKeyword') === 'manager') {
    pass('buildForm carries startIndex, jobCountry, countrySite, jobKeyword');
  } else fail('buildForm fields wrong');

  const sample = {
    data: [
      { title: ' Engineering Manager ', jobDetailUrl: 'https://www.accenture.com/{0}/careers/jobdetails?id=R1_en', location: ['Austin, TX', 'Boston, MA'], remoteType: 'Hybrid', jobDescriptionClean: 'Lead a team.' },
      { title: 'Director', jobDetailUrl: 'https://www.accenture.com/{0}/careers/jobdetails?id=R2_en', location: 'Remote' },
      { title: '', jobDetailUrl: 'https://www.accenture.com/{0}/careers/jobdetails?id=R3_en' },
      { title: 'No URL' },
      { title: 'Bad scheme', jobDetailUrl: 'ftp://x/{0}' },
    ],
  };
  const jobs = parseAccentureResponse(sample, 'us-en');
  if (jobs.length === 2 && jobs[0].company === 'Accenture' && jobs[0].title === 'Engineering Manager') pass('parse keeps valid rows, trims title, sets company');
  else fail(`parse returned ${JSON.stringify(jobs)}`);
  if (jobs[0].url === 'https://www.accenture.com/us-en/careers/jobdetails?id=R1_en') pass('parse substitutes {0} with the site locale');
  else fail(`url = ${jobs[0]?.url}`);
  if (jobs[0].location === 'Austin, TX, Boston, MA · Hybrid' && jobs[1].location === 'Remote') pass('parse joins location array + remote type');
  else fail(`locations = ${JSON.stringify(jobs.map(j => j.location))}`);
  if (jobs[0].description === 'Lead a team.' && jobs[1].description === undefined) pass('parse passes JD text through when present');
  else fail('description handling wrong');

  let drifted = false;
  try { parseAccentureResponse({ results: [] }, 'us-en'); } catch { drifted = true; }
  if (drifted) pass('parse throws when data[] is missing');
  else fail('parse should throw on unexpected response shape');

  // fetch() — paginates until a short page, dedups by URL
  const calls = [];
  const mkPage = (n, offset) => ({
    data: Array.from({ length: n }, (_, i) => ({ title: `Job ${offset + i}`, jobDetailUrl: `https://www.accenture.com/{0}/careers/jobdetails?id=R${offset + i}_en` })),
    totalHits: { total: 60 },
  });
  const ctx = {
    async fetchJson(url, opts) {
      calls.push({ url, opts });
      return calls.length === 1 ? mkPage(50, 0) : mkPage(10, 50);
    },
  };
  const out = await accenture.fetch({ accenture: {} }, ctx);
  if (out.length === 60 && calls.length === 2) pass('fetch paginates until a short page');
  else fail(`fetch returned ${out.length} jobs in ${calls.length} calls`);
  if (calls[0].opts.method === 'POST' && calls[0].opts.body instanceof FormData && !('content-type' in calls[0].opts.headers)) {
    pass('fetch POSTs FormData without a manual content-type');
  } else fail('fetch request shape wrong');
} catch (err) {
  fail(`accenture provider test crashed: ${err.message}`);
}
