#!/usr/bin/env node
// One-off: registers analytics.js DIMENSIONS / METRICS as event-scoped GA4 custom definitions (Admin API).
// Already-registered parameters are skipped, so it is safe to re-run.
//
//   gcloud auth application-default login \
//     --scopes=https://www.googleapis.com/auth/analytics.edit,https://www.googleapis.com/auth/cloud-platform
//   node scripts/register-ga-definitions.js <property id> [--dry-run] [--quota-project <gcp project>]
//
// <property id> is the numeric id from Admin › Property details (not the G-… measurement id).
const { execFileSync } = require('node:child_process');
const { DIMENSIONS, METRICS } = require('../analytics.js');

const args = process.argv.slice(2);
const property = (args.find(a => !a.startsWith('--')) || '').replace(/^properties\//, '');
const dryRun = args.includes('--dry-run');
const quotaProject = args.includes('--quota-project') ? args[args.indexOf('--quota-project') + 1] : null;
if (!/^\d+$/.test(property)) {
    console.error('Usage: node scripts/register-ga-definitions.js <numeric property id> [--dry-run] [--quota-project <id>]');
    process.exit(1);
}

const API = `https://analyticsadmin.googleapis.com/v1beta/properties/${property}`;
const token = process.env.GA_ACCESS_TOKEN
    || execFileSync('gcloud', ['auth', 'application-default', 'print-access-token'], { encoding: 'utf8' }).trim();
const headers = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(quotaProject ? { 'x-goog-user-project': quotaProject } : {})
};

const displayName = p => p.charAt(0).toUpperCase() + p.slice(1).replace(/_/g, ' ');

async function call(path, options = {}) {
    const res = await fetch(`${API}/${path}`, { headers, ...options });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status} ${body.error?.message || res.statusText}`);
    return body;
}

async function existing(kind) {
    const names = new Set();
    let pageToken = '';
    do {
        const page = await call(`${kind}?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ''}`);
        (page[kind] || []).forEach(d => names.add(d.parameterName));
        pageToken = page.nextPageToken || '';
    } while (pageToken);
    return names;
}

async function register(kind, params, toBody) {
    const have = await existing(kind);
    let created = 0, failed = 0;
    for (const p of params) {
        if (have.has(p)) { console.log(`  skip    ${p} (already registered)`); continue; }
        if (dryRun) { console.log(`  would   ${p}`, JSON.stringify(toBody(p))); continue; }
        try {
            await call(kind, { method: 'POST', body: JSON.stringify(toBody(p)) });
            console.log(`  created ${p}`);
            created++;
        } catch (e) {
            console.log(`  FAILED  ${p}: ${e.message}`);
            failed++;
        }
    }
    return { created, failed };
}

(async () => {
    console.log(`Custom dimensions (${DIMENSIONS.length})${dryRun ? ' [dry run]' : ''}`);
    const d = await register('customDimensions', DIMENSIONS,
        p => ({ parameterName: p, displayName: displayName(p), scope: 'EVENT' }));
    console.log(`Custom metrics (${METRICS.length})${dryRun ? ' [dry run]' : ''}`);
    const m = await register('customMetrics', METRICS, p => ({
        parameterName: p, displayName: displayName(p), scope: 'EVENT',
        measurementUnit: p.endsWith('_sec') ? 'SECONDS' : 'STANDARD'
    }));
    if (!dryRun) console.log(`\nCreated ${d.created + m.created}, failed ${d.failed + m.failed}.`);
    process.exit(d.failed + m.failed ? 1 : 0);
})().catch(e => { console.error(e.message); process.exit(1); });
