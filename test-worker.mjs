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
  'test-automotive-public': {
    id: 'test-auto-uuid',
    slug: 'test-automotive-public',
    business_name: 'Test Automotive Dealer',
    description: 'A test automotive dealer for skill verification.',
    industry: 'Volkswagen',
    business_type: 'automotive',
    services: [],
    service_area: { city: 'Austin', state: 'TX', regions: ['Texas'] },
    phone: '512-555-0100',
    email: 'sales@example.com',
    website: 'https://example.com',
    booking_url: 'https://example.com/schedule',
    hours: { mon: '9am-8pm' },
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
      return { ok: true, status: 200, json: async () => [], text: async () => '' };
    }
    return {
      ok: true,
      status: 200,
      json: async () => (row ? [row] : []),
      text: async () => '',
    };
  }
  if (urlStr.includes('/rest/v1/products')) {
    // Return a couple of fixture products for any client_id query
    return {
      ok: true,
      status: 200,
      json: async () => ([
        {
          id: 'p1',
          slug: 'sample-jacket',
          name: 'Sample Leather Jacket',
          category: 'jackets',
          price_cents: 49500,
          in_stock: true,
          image_url: 'https://placehold.co/600x800/5C3A21/ffffff?text=Jacket',
          product_url: 'https://example.com/jacket',
        },
        {
          id: 'p2',
          slug: 'sample-skirt',
          name: 'Sample Studded Skirt',
          category: 'skirts',
          price_cents: 29500,
          in_stock: false,
          image_url: 'https://placehold.co/600x800/0a0a0a/ffffff?text=Skirt',
          product_url: 'https://example.com/skirt',
        },
      ]),
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

console.log('\n=== Automotive client (public, not demo) ===');
await test('returns 8 automotive skills', async () => {
  const res = await get('/test-automotive-public');
  assertEq(res.status, 200, 'status');
  const card = await res.json();
  assertEq(card.skills.length, 8, 'automotive skill count');
  const ids = card.skills.map(s => s.id).sort();
  const expected = [
    'contact_sales',
    'get_availability',
    'get_business_profile',
    'get_reviews',
    'get_specials',
    'get_vehicle_details',
    'schedule_service_appointment',
    'search_inventory',
  ];
  assertEq(ids.join(','), expected.join(','), 'expected 8 skill ids');
  assertEq(card.metadata.businessType, 'automotive', 'metadata businessType');
});

await test('search_inventory skill mentions the dealer name', async () => {
  const res = await get('/test-automotive-public');
  const card = await res.json();
  const si = card.skills.find(s => s.id === 'search_inventory');
  assert(si, 'search_inventory present');
  assert(si.description.includes('Test Automotive Dealer'), 'mentions dealer');
});

await test('get_services is absent from automotive card', async () => {
  const res = await get('/test-automotive-public');
  const card = await res.json();
  const ids = card.skills.map(s => s.id);
  assert(!ids.includes('get_services'), 'get_services correctly absent');
});

console.log('\n=== Viewer route — service client ===');
await test('returns HTML for service client viewer', async () => {
  const res = await get('/grandinetti-molinar-law/view');
  assertEq(res.status, 200, 'status');
  assertEq(res.headers.get('content-type').startsWith('text/html'), true, 'content type is HTML');
  const html = await res.text();
  assert(html.includes('<!DOCTYPE html>'), 'has doctype');
  assert(html.includes('Grandinetti &amp; Molinar Law'), 'business name rendered');
  assert(html.includes('Family Law'), 'services rendered');
  assert(html.includes('Powered by'), 'powered by footer');
  assert(html.includes('Lead Stampede'), 'lead stampede attribution');
});

await test('service viewer includes contact buttons', async () => {
  const res = await get('/grandinetti-molinar-law/view');
  const html = await res.text();
  assert(html.includes('Call '), 'has call button');
  assert(html.includes('tel:'), 'has tel: link');
  assert(html.includes('Visit Website'), 'has website button');
});

await test('service viewer does NOT render product grid', async () => {
  const res = await get('/grandinetti-molinar-law/view');
  const html = await res.text();
  assert(!html.includes('Featured Products'), 'no product section');
  assert(!html.includes('products-grid'), 'no products grid class');
});

console.log('\n=== Viewer route — public e-commerce client ===');
await test('returns HTML for e-commerce client viewer with products', async () => {
  const res = await get('/test-ecommerce-public/view');
  assertEq(res.status, 200, 'status');
  const html = await res.text();
  assert(html.includes('Test Public Store'), 'brand name rendered');
  assert(html.includes('Featured'), 'featured section present');
  assert(html.includes('Sample Leather Jacket'), 'first product rendered');
  assert(html.includes('Sample Studded Skirt'), 'second product rendered');
  assert(html.includes('$495.00') || html.includes('$495'), 'price formatted correctly');
  assert(html.includes('Sold out'), 'out-of-stock product shows sold out');
});

await test('e-commerce viewer does NOT render service-y elements', async () => {
  const res = await get('/test-ecommerce-public/view');
  const html = await res.text();
  assert(!html.includes('services-grid'), 'no services grid');
  assert(!html.includes('Book Online'), 'no booking button');
});

await test('e-commerce viewer renders Browse the full shop link', async () => {
  const res = await get('/test-ecommerce-public/view');
  const html = await res.text();
  assert(html.includes('Browse the full shop'), 'shop CTA present');
});

console.log('\n=== Viewer route — demo-mode isolation ===');
await test('demo-only client returns 404 HTML for viewer', async () => {
  const res = await get('/understated-leather/view');
  assertEq(res.status, 404, 'should 404');
  assertEq(res.headers.get('content-type').startsWith('text/html'), true, 'returns HTML 404 page');
  const html = await res.text();
  assert(html.includes('Not found'), 'shows not found');
  assert(html.includes('understated-leather'), 'shows the requested slug');
});

await test('unknown slug on viewer also returns HTML 404', async () => {
  const res = await get('/does-not-exist-anywhere/view');
  assertEq(res.status, 404, 'should 404');
  assertEq(res.headers.get('content-type').startsWith('text/html'), true, 'HTML 404');
});

console.log('\n=== Viewer security — HTML escaping ===');
await test('dangerous strings in business data are escaped', async () => {
  // Inject a new fixture with a script-injection attempt in business_name
  fixtures['evil-client'] = {
    id: 'evil-uuid',
    slug: 'evil-client',
    business_name: '<script>alert(1)</script>Evil Co',
    tagline: 'tagline " onmouseover=alert(2)',
    description: 'desc',
    industry: 'services',
    business_type: 'service',
    services: ['<img src=x onerror=alert(3)>'],
    service_area: { city: 'Austin' },
    phone: null, email: null, website: null, shop_url: null, booking_url: null,
    hours: {},
    demo_only: false,
    active: true,
  };
  const res = await get('/evil-client/view');
  const html = await res.text();
  // Real test: make sure no raw script tag exists
  assert(!html.includes('<script>alert(1)'), 'script tag not rendered raw');
  assert(html.includes('&lt;script&gt;'), 'script tag properly escaped to entities');
  // Real test: make sure quotes in tagline are escaped so they can't break out of the attribute context
  // (even though tagline is in element body not attribute, we still want &quot;)
  assert(html.includes('&quot;'), 'quote escaped to entity');
  // Real test: make sure the img tag is rendered as text, not as an actual img element
  assert(!html.includes('<img src=x onerror'), 'raw img tag not rendered');
  assert(html.includes('&lt;img src=x onerror=alert(3)&gt;'), 'img tag properly escaped');
});

console.log('\n=== Sample output: e-commerce viewer (truncated) ===');
const viewerRes = await get('/test-ecommerce-public/view');
const viewerHtml = await viewerRes.text();
console.log(viewerHtml.slice(0, 1500) + '\n[...truncated...]\n');

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
