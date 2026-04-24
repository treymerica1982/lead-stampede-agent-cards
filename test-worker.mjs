// Local test for Worker v2 — no Cloudflare or Supabase needed.
// Mocks the Supabase fetch to return a service client and an e-commerce client,
// then validates the card output for each.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Fixtures
const fixtures = {
  'grandinetti-molinar-law': {
    id: 'gm-uuid',
    slug: 'grandinetti-molinar-law',
    business_name: 'Grandinetti & Molinar Law',
    tagline: 'Austin law firm',
    description: 'An Austin-based law firm.',
    industry: 'legal',
    business_type: 'service',
    services: ['Family Law', 'Estate Planning', 'Real Estate Litigation'],
    service_area: { city: 'Austin', state: 'TX', offices: ['Austin', 'San Antonio', 'El Paso'] },
    phone: '(512) 477-2600',
    email: null,
    website: 'https://gmlawtexas.com',
    shop_url: null,
    booking_url: null,
    hours: { mon: '8:30am-5:00pm' },
    active: true,
  },
  'understated-leather': {
    id: 'ul-uuid',
    slug: 'understated-leather',
    business_name: 'Understated Leather',
    tagline: 'Austin leather house',
    description: 'Austin-based leather fashion.',
    industry: 'fashion',
    business_type: 'ecommerce',
    services: [],
    service_area: { city: 'Austin', state: 'TX', ships_to: ['United States', 'Canada'] },
    phone: null,
    email: 'hello@understatedleather.com',
    website: 'https://understatedleather.com',
    shop_url: 'https://understatedleather.com/shop',
    booking_url: null,
    hours: { mon: '9am-5pm CT' },
    currency: 'USD',
    return_policy: '30 days',
    demo_only: true,
    active: true,
  },
  'harris-ryan-homes': {
    id: 'hr-uuid',
    slug: 'harris-ryan-homes',
    business_name: 'Harris Ryan Homes',
    description: 'Luxury custom home builder.',
    industry: 'home_builder',
    business_type: 'service',
    services: [], // Testing: empty services list on a service client
    service_area: { city: 'Texas', state: 'TX', regions: ['Texas'] },
    phone: null,
    email: null,
    website: 'https://harrisryanhomes.com',
    shop_url: null,
    booking_url: null,
    hours: { mon: '9am-5pm' },
    demo_only: false,
    active: true,
  },
  // Non-demo e-commerce client for testing the ecommerce skills path
  // without requiring a real demo client
  'test-ecommerce-public': {
    id: 'tep-uuid',
    slug: 'test-ecommerce-public',
    business_name: 'Test Public Store',
    description: 'A public e-commerce store for skill-branch tests.',
    industry: 'fashion',
    business_type: 'ecommerce',
    services: [],
    service_area: { city: 'Austin', state: 'TX', ships_to: ['United States'] },
    phone: null,
    email: 'hi@example.com',
    website: 'https://example.com',
    shop_url: 'https://example.com/shop',
    booking_url: null,
    hours: {},
    demo_only: false,
    active: true,
  },
};

globalThis.fetch = async (url) => {
  const urlStr = url.toString();
  if (urlStr.includes('/rest/v1/clients')) {
    const match = urlStr.match(/slug=eq\.([^&]+)/);
    const slug = match ? decodeURIComponent(match[1]) : null;
    const row = fixtures[slug];
    // If the query includes demo_only=eq.false, respect it (public Worker path)
    const demoOnlyFilter = /demo_only=eq\.false/.test(urlStr);
    if (demoOnlyFilter && row && row.demo_only === true) {
      // Demo client hidden from public Worker — return empty result
      return { ok: true, status: 200, json: async () => [], text: async () => '' };
    }
    return {
      ok: true,
      status: 200,
      json: async () => (row ? [row] : []),
      text: async () => '',
    };
  }
  if (urlStr.includes('/rest/v1/agent_card_views')) {
    return { ok: true, status: 201, json: async () => ({}), text: async () => '' };
  }
  return { ok: false, status: 500, json: async () => ({}), text: async () => 'unmocked' };
};

const mockCtx = { waitUntil: (p) => p.catch(() => {}) };
const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  MCP_BASE_URL: 'https://lead-stampede-mcp-server-production.up.railway.app',
};

const { default: handler } = await import('./src/worker.js');

let passed = 0, failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    failed++;
  }
}

function assert(cond, msg) { if (!cond) throw new Error(msg); }
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

async function get(p) {
  return await handler.fetch(new Request(`https://w.example.com${p}`, { method: 'GET' }), env, mockCtx);
}

console.log('\n=== Service client (GM Law — full service with 3 services) ===');
await test('returns service skills with services list populated', async () => {
  const res = await get('/grandinetti-molinar-law');
  assertEq(res.status, 200, 'status');
  const card = await res.json();
  assertEq(card.skills.length, 4, 'skill count');
  const ids = card.skills.map(s => s.id);
  assertEq(ids.join(','), 'get_business_profile,get_services,get_availability,get_reviews', 'skill ids');
  const services = card.skills.find(s => s.id === 'get_services');
  assert(services.description.includes('Family Law'), 'services description includes service list');
  assert(!services.description.includes('undefined'), 'no undefined leaks');
  assert(!services.description.endsWith('Services: .'), 'no empty services trailing');
  const ex = services.examples.find(e => e.includes('Family Law'));
  assert(ex, 'example mentions the sample service');
  assertEq(card.metadata.businessType, 'service', 'metadata businessType');
});

console.log('\n=== Service client (Harris Ryan — EMPTY services list, tests bug fix #1) ===');
await test('handles empty services list gracefully', async () => {
  const res = await get('/harris-ryan-homes');
  const card = await res.json();
  const services = card.skills.find(s => s.id === 'get_services');
  assert(!services.description.includes('undefined'), 'no undefined leak');
  assert(!services.description.endsWith('Services: .'), 'no empty services trailing');
  assert(!services.description.includes(': .'), 'no orphaned colon-period');
  const sample = services.examples.find(e => e.includes('Does Harris Ryan Homes do'));
  assert(sample, 'has a sample-service example');
  assert(!sample.includes('undefined'), 'example has no undefined');
});

console.log('\n=== E-commerce client (public, not demo) ===');
await test('returns 6 e-commerce skills, NOT the service ones', async () => {
  const res = await get('/test-ecommerce-public');
  assertEq(res.status, 200, 'status');
  const card = await res.json();
  assertEq(card.skills.length, 6, 'ecommerce skill count');
  const ids = card.skills.map(s => s.id).sort();
  assertEq(
    ids.join(','),
    ['get_availability', 'get_business_profile', 'get_collection', 'get_product_details', 'get_reviews', 'search_products'].sort().join(','),
    'expected 6 skill ids'
  );
  assertEq(card.metadata.businessType, 'ecommerce', 'metadata businessType');
});

await test('search_products skill has good description', async () => {
  const res = await get('/test-ecommerce-public');
  const card = await res.json();
  const sp = card.skills.find(s => s.id === 'search_products');
  assert(sp, 'search_products present');
  assert(sp.description.includes('Test Public Store'), 'mentions brand');
});

await test('get_availability is e-commerce-flavored, not service-flavored', async () => {
  const res = await get('/test-ecommerce-public');
  const card = await res.json();
  const avail = card.skills.find(s => s.id === 'get_availability');
  assert(!avail.description.toLowerCase().includes('book'), 'no booking language on e-commerce');
  assert(!avail.examples.some(e => e.toLowerCase().includes('appointment')), 'no appointment example');
});

await test('get_business_profile renamed to Brand Profile for e-commerce', async () => {
  const res = await get('/test-ecommerce-public');
  const card = await res.json();
  const profile = card.skills.find(s => s.id === 'get_business_profile');
  assertEq(profile.name, 'Get Brand Profile', 'renamed to Brand Profile');
});

await test('ships_to from service_area surfaces in metadata', async () => {
  const res = await get('/test-ecommerce-public');
  const card = await res.json();
  assert(card.metadata.serviceArea.includes('Ships to:'), 'metadata should include Ships to:');
  assert(card.metadata.serviceArea.includes('United States'), 'mentions at least one shipping country');
});

console.log('\n=== Demo-mode isolation (Understated Leather) ===');
await test('demo-only client returns 404 on public Worker', async () => {
  const res = await get('/understated-leather');
  assertEq(res.status, 404, 'should 404 — demo client invisible to public');
  const body = await res.json();
  assertEq(body.error, 'client_not_found', 'clean error response');
});

await test('well-known path also returns 404 for demo-only client', async () => {
  const res = await get('/understated-leather/.well-known/agent-card.json');
  assertEq(res.status, 404, 'should 404 on .well-known too');
});

console.log('\n=== MCP URL still embedded correctly ===');
await test('both card types point at the Railway URL', async () => {
  for (const slug of ['grandinetti-molinar-law', 'test-ecommerce-public']) {
    const res = await get(`/${slug}`);
    const card = await res.json();
    assert(card.supportedInterfaces[0].url.includes('railway.app'), `${slug} points at railway`);
    assert(card.supportedInterfaces[0].url.endsWith('/mcp/tools'), `${slug} ends with /mcp/tools`);
  }
});

console.log('\n=== Error paths still work ===');
await test('404 for unknown client', async () => {
  const res = await get('/does-not-exist');
  assertEq(res.status, 404, 'status');
});

await test('well-known path works for e-commerce too', async () => {
  const res = await get('/test-ecommerce-public/.well-known/agent-card.json');
  assertEq(res.status, 200, 'status');
  const card = await res.json();
  assertEq(card.skills.length, 6, 'ecommerce skill count via well-known');
});

console.log('\n=== Sample output: public e-commerce card ===');
const sampleRes = await get('/test-ecommerce-public');
const sampleCard = await sampleRes.json();
console.log(JSON.stringify(sampleCard, null, 2).slice(0, 2000) + '...\n[truncated]');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
