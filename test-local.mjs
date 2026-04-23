// Local structural test for the Worker — no Cloudflare or Supabase needed.
// Mocks fetch() so we can validate the Agent Card output for real client data.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workerSrc = readFileSync(path.join(__dirname, 'src/worker.js'), 'utf8');

// Fixtures mirroring the real Supabase rows
const fixtures = {
  'lead-stampede': {
    id: 'ls-uuid',
    slug: 'lead-stampede',
    business_name: 'Lead Stampede',
    tagline: 'Modern lead generation for businesses ready to grow',
    description: 'Lead Stampede helps businesses modernize their lead generation with three core offerings: building A2A protocols that make your business discoverable by AI-powered agentic search, modernizing inbound lead flow with immediate AI-driven responses and expert appointment setting, and executing outbound campaigns that drive qualified pipeline.',
    industry: 'marketing_services',
    services: ['A2A / Agentic Search Discoverability', 'Inbound Lead Response & Appointment Setting', 'Outbound Lead Generation Campaigns', 'SMS Automation', 'AI Sales Agent Deployment'],
    pricing_summary: 'Custom pricing based on business size and scope.',
    service_area: { city: 'Austin', state: 'TX', regions: ['Central Texas', 'Austin', 'San Antonio', 'Dallas', 'Houston'] },
    phone: null, email: 'trey@leadstampede.io', website: 'https://leadstampede.io',
    booking_url: 'https://calendly.com/leadstampede',
    hours: { mon: '9am-5pm', tue: '9am-5pm' },
    active: true,
  },
  'grandinetti-molinar-law': {
    id: 'gm-uuid',
    slug: 'grandinetti-molinar-law',
    business_name: 'Grandinetti & Molinar Law',
    tagline: 'Austin-based attorneys delivering high-quality legal services without senseless over-billing',
    description: 'Grandinetti & Molinar Law is an Austin-based law firm founded in 2002.',
    industry: 'legal',
    services: ['Family Law', 'Divorce & Custody', 'Real Estate & Construction Litigation', 'General Civil Litigation', 'Contract Disputes', 'Probate & Guardianship', 'Estate Planning'],
    pricing_summary: 'Consultation fees vary by matter.',
    service_area: { city: 'Austin', state: 'TX', offices: ['Austin', 'San Antonio', 'El Paso'] },
    phone: '(512) 477-2600', email: null, website: 'https://gmlawtexas.com',
    booking_url: null,
    hours: { mon: '8:30am-5:00pm' },
    active: true,
  },
  'harris-ryan-homes': {
    id: 'hr-uuid',
    slug: 'harris-ryan-homes',
    business_name: 'Harris Ryan Homes',
    tagline: 'Boutique luxury custom home builder with over 30 years of experience in Texas',
    description: 'Harris Ryan Homes is a boutique custom home builder.',
    industry: 'home_builder',
    services: ['Custom Home Design & Build', 'Luxury Home Construction', 'Architectural Consultation', 'Design-Build Services', 'New Home Construction'],
    pricing_summary: 'Custom pricing based on project scope.',
    service_area: { city: 'Texas', state: 'TX', regions: ['Texas'] },
    phone: null, email: null, website: 'https://harrisryanhomes.com',
    booking_url: null,
    hours: { mon: '9am-5pm' },
    active: true,
  },
};

// Mock global fetch — intercept Supabase calls, let everything else fail
globalThis.fetch = async (url, opts) => {
  const urlStr = url.toString();
  if (urlStr.includes('/rest/v1/clients')) {
    const match = urlStr.match(/slug=eq\.([^&]+)/);
    const slug = match ? decodeURIComponent(match[1]) : null;
    const row = fixtures[slug];
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

// Mock the Cloudflare Workers execution context
const mockCtx = {
  waitUntil: (promise) => promise.catch(() => {}),
};

const env = {
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
  MCP_BASE_URL: 'https://mcp.leadstampede.io',
};

// Dynamically import the Worker module
const workerModule = await import('./src/worker.js');
const handler = workerModule.default;

// --------- Run tests ---------
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
function assertEq(a, b, msg) { if (a !== b) throw new Error(`${msg}: expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }

async function get(path) {
  return await handler.fetch(
    new Request(`https://worker.example.com${path}`, { method: 'GET' }),
    env,
    mockCtx
  );
}

console.log('\n=== Root & health ===');
await test('GET / returns landing JSON', async () => {
  const res = await get('/');
  assertEq(res.status, 200, 'status');
  const body = await res.json();
  assert(body.service, 'service field missing');
});

await test('GET /health returns ok', async () => {
  const res = await get('/health');
  const body = await res.json();
  assertEq(body.status, 'ok', 'status not ok');
});

console.log('\n=== Agent Cards for real clients ===');
for (const slug of Object.keys(fixtures)) {
  await test(`GET /${slug} returns valid A2A Agent Card`, async () => {
    const res = await get(`/${slug}`);
    assertEq(res.status, 200, 'status');
    const card = await res.json();

    // A2A spec required fields
    assert(card.name, 'name missing');
    assert(card.description, 'description missing');
    assert(card.version, 'version missing');
    assert(card.capabilities, 'capabilities missing');
    assert(Array.isArray(card.defaultInputModes), 'defaultInputModes missing');
    assert(Array.isArray(card.defaultOutputModes), 'defaultOutputModes missing');
    assert(Array.isArray(card.skills), 'skills missing');
    assert(card.skills.length === 4, 'should have 4 skills');
    assert(Array.isArray(card.supportedInterfaces), 'supportedInterfaces missing');
    assert(card.supportedInterfaces[0].url.includes('mcp.leadstampede.io'), 'MCP URL wrong');

    // Each skill must have required fields
    for (const skill of card.skills) {
      assert(skill.id && skill.name && skill.description, `skill ${skill.id} missing fields`);
      assert(Array.isArray(skill.tags), `skill ${skill.id} tags missing`);
      assert(Array.isArray(skill.examples), `skill ${skill.id} examples missing`);
    }

    // Client-specific
    assertEq(card.metadata.clientSlug, slug, 'slug mismatch');
  });
}

await test('GET /{slug}/.well-known/agent-card.json works', async () => {
  const res = await get('/grandinetti-molinar-law/.well-known/agent-card.json');
  assertEq(res.status, 200, 'status');
  const card = await res.json();
  assertEq(card.name, 'Grandinetti & Molinar Law', 'name');
});

console.log('\n=== Error paths ===');
await test('GET /nonexistent returns 404', async () => {
  const res = await get('/nonexistent-client');
  assertEq(res.status, 404, 'status');
});

await test('GET /foo/bar returns 400 (invalid path)', async () => {
  const res = await get('/foo/bar');
  assertEq(res.status, 400, 'status');
});

await test('POST /any returns 405', async () => {
  const res = await handler.fetch(
    new Request('https://w/', { method: 'POST' }),
    env,
    mockCtx
  );
  assertEq(res.status, 405, 'status');
});

await test('OPTIONS preflight returns 204 with CORS', async () => {
  const res = await handler.fetch(
    new Request('https://w/acme', { method: 'OPTIONS' }),
    env,
    mockCtx
  );
  assertEq(res.status, 204, 'status');
  assert(res.headers.get('Access-Control-Allow-Origin'), 'CORS missing');
});

console.log('\n=== Sample output ===');
const sampleRes = await get('/grandinetti-molinar-law');
const sampleCard = await sampleRes.json();
console.log(JSON.stringify(sampleCard, null, 2));

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
