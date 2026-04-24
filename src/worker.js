/**
 * Lead Stampede — Agent Card Worker
 *
 * Serves A2A-compliant Agent Cards at:
 *   GET /{slug}                              (convenience path)
 *   GET /{slug}/.well-known/agent-card.json  (spec-recommended path)
 *
 * Each card describes one client's capabilities and points AI agents
 * at the MCP server where those capabilities are actually executed.
 *
 * The card's contents automatically adapt to the client's business_type:
 *   - "service"   → profile, services, availability, reviews
 *   - "ecommerce" → profile, product search, collections, availability, reviews
 */

const CARD_VERSION = '1.2.0';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const startedAt = Date.now();

    // CORS preflight — AI agents calling from browsers need this
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (request.method !== 'GET') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    // Root — simple landing for humans who stumble here
    if (url.pathname === '/' || url.pathname === '') {
      return json({
        service: 'Lead Stampede Agent Card Directory',
        usage: 'GET /{client-slug} to retrieve an Agent Card',
        documentation: 'https://leadstampede.io',
      });
    }

    if (url.pathname === '/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    const slug = extractSlug(url.pathname);
    if (!slug) {
      return json({ error: 'invalid_path', message: 'Expected /{client-slug}' }, 400);
    }

    const client = await fetchClient(slug, env);
    if (!client) {
      return json({ error: 'client_not_found', slug }, 404);
    }

    const card = buildAgentCard(client, env);

    ctx.waitUntil(
      logCardView({
        clientId: client.id,
        requestingAgent: request.headers.get('User-Agent'),
        sourceIp: request.headers.get('CF-Connecting-IP'),
        responseMs: Date.now() - startedAt,
        env,
      })
    );

    return json(card, 200, {
      'Cache-Control': 'public, max-age=300', // 5-minute cache
    });
  },
};

// ---------------------------------------------------------------------
// Path parsing — strips optional /.well-known/agent-card.json suffix
// ---------------------------------------------------------------------
function extractSlug(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) return parts[0];
  if (parts.length === 3 && parts[1] === '.well-known' && parts[2] === 'agent-card.json') {
    return parts[0];
  }
  return null;
}

// ---------------------------------------------------------------------
// Supabase — public read via anon key.
// Filters: active=true AND demo_only=false.
// Demo clients (demo_only=true) are invisible to the public web;
// they're only reachable via the MCP server with the demo agency API key.
// ---------------------------------------------------------------------
async function fetchClient(slug, env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&active=eq.true&demo_only=eq.false&select=*`,
    {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
    }
  );

  if (!res.ok) {
    console.error(`[supabase] ${res.status} ${await res.text()}`);
    return null;
  }

  const rows = await res.json();
  return rows[0] || null;
}

async function logCardView({ clientId, requestingAgent, sourceIp, responseMs, env }) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/agent_card_views`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        client_id: clientId,
        requesting_agent: requestingAgent,
        source_ip: sourceIp,
        response_ms: responseMs,
      }),
    });
  } catch (err) {
    console.error('[analytics]', err.message);
  }
}

// ---------------------------------------------------------------------
// Agent Card builder — routes on business_type
// Spec: https://a2a-protocol.org/latest/specification/
// ---------------------------------------------------------------------
function buildAgentCard(client, env) {
  const mcpBase = env.MCP_BASE_URL || 'http://localhost:3000';
  const businessType = client.business_type || 'service';

  const skills =
    businessType === 'ecommerce'
      ? buildEcommerceSkills(client)
      : buildServiceSkills(client);

  return {
    name: client.business_name,
    description: client.description,

    provider: {
      organization: 'Lead Stampede',
      url: 'https://leadstampede.io',
    },

    version: CARD_VERSION,
    documentationUrl: client.website || client.shop_url || 'https://leadstampede.io',

    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },

    defaultInputModes: ['text'],
    defaultOutputModes: ['application/json', 'text'],

    skills,

    supportedInterfaces: [
      {
        protocolBinding: 'REST',
        url: `${mcpBase}/mcp/tools`,
      },
    ],

    metadata: {
      businessName: client.business_name,
      tagline: client.tagline,
      industry: client.industry,
      businessType,
      serviceArea: describeServiceArea(client.service_area),
      clientSlug: client.slug,
    },
  };
}

// ---------------------------------------------------------------------
// Skill builders per business type
// ---------------------------------------------------------------------

function buildServiceSkills(client) {
  const hasServices = Array.isArray(client.services) && client.services.length > 0;
  const serviceList = hasServices ? client.services : [];
  const serviceSummary = hasServices ? serviceList.join(', ') : null;
  const sampleService = hasServices ? serviceList[0] : 'consultations';

  return [
    {
      id: 'get_business_profile',
      name: 'Get Business Profile',
      description: `Returns name, description, industry, service area, and contact info for ${client.business_name}.`,
      tags: ['profile', 'contact', 'about', client.industry].filter(Boolean),
      examples: [
        `Tell me about ${client.business_name}`,
        `Where is ${client.business_name} located?`,
        `How do I contact ${client.business_name}?`,
      ],
    },
    {
      id: 'get_services',
      name: 'Get Services and Pricing',
      description: serviceSummary
        ? `Returns the services offered by ${client.business_name} and any available pricing info. Services include: ${serviceSummary}.`
        : `Returns the services offered by ${client.business_name} and any available pricing info.`,
      tags: ['services', 'pricing', 'offerings', client.industry].filter(Boolean),
      examples: [
        `What services does ${client.business_name} offer?`,
        `How much does ${client.business_name} charge?`,
        `Does ${client.business_name} do ${sampleService}?`,
      ],
    },
    {
      id: 'get_availability',
      name: 'Get Availability and Booking',
      description: `Returns business hours and booking options for ${client.business_name}. ${
        client.booking_url ? 'Online scheduling is available.' : 'Contact directly to book.'
      }`,
      tags: ['hours', 'availability', 'booking', 'schedule'],
      examples: [
        `When is ${client.business_name} open?`,
        `Can I book an appointment with ${client.business_name}?`,
        `What are ${client.business_name}'s hours?`,
      ],
    },
    {
      id: 'get_reviews',
      name: 'Get Reviews and Reputation',
      description: `Returns review count, average rating, and a summary of customer feedback for ${client.business_name}.`,
      tags: ['reviews', 'ratings', 'reputation', 'social-proof'],
      examples: [
        `What do people say about ${client.business_name}?`,
        `How many reviews does ${client.business_name} have?`,
        `Is ${client.business_name} any good?`,
      ],
    },
  ];
}

function buildEcommerceSkills(client) {
  const industry = client.industry || 'products';
  const brandName = client.business_name;

  return [
    {
      id: 'get_business_profile',
      name: 'Get Brand Profile',
      description: `Returns brand story, description, shipping region, and contact info for ${brandName}.`,
      tags: ['profile', 'about', 'brand', industry].filter(Boolean),
      examples: [
        `Tell me about ${brandName}`,
        `Where does ${brandName} ship?`,
        `What's the story behind ${brandName}?`,
      ],
    },
    {
      id: 'search_products',
      name: 'Search Products',
      description: `Searches the ${brandName} catalog by natural-language query, with optional filters for category, price range, collection, and in-stock status. Returns matching products with name, price, image, and product page URL.`,
      tags: ['products', 'search', 'shop', 'catalog', industry].filter(Boolean),
      examples: [
        `Show me leather jackets from ${brandName}`,
        `What does ${brandName} have under $400?`,
        `Find fringe accessories at ${brandName}`,
        `Browse ${brandName}'s bestsellers`,
      ],
    },
    {
      id: 'get_product_details',
      name: 'Get Product Details',
      description: `Returns full details for a specific ${brandName} product: name, description, price, available sizes and colors, stock status, and product page URL.`,
      tags: ['product', 'details', 'sizing', 'stock', industry].filter(Boolean),
      examples: [
        `Tell me more about that ${brandName} jacket`,
        `What sizes are available?`,
        `Is it in stock?`,
      ],
    },
    {
      id: 'get_collection',
      name: 'Browse Collections',
      description: `Lists the collections available at ${brandName} or returns every product in a named collection. Use this for seasonal drops or curated ranges.`,
      tags: ['collections', 'lookbook', 'seasonal', 'drops', industry].filter(Boolean),
      examples: [
        `What collections does ${brandName} have?`,
        `Show me everything in the Southern Sunrise collection`,
        `What's new this season at ${brandName}?`,
      ],
    },
    {
      id: 'get_availability',
      name: 'Get Shop Hours and Info',
      description: `Returns shop information for ${brandName}: online shop link, customer service hours, shipping and return policies.`,
      tags: ['shop', 'hours', 'customer-service', 'shipping'],
      examples: [
        `When does ${brandName} ship?`,
        `What's ${brandName}'s return policy?`,
        `How do I reach customer service at ${brandName}?`,
      ],
    },
    {
      id: 'get_reviews',
      name: 'Get Brand Reviews',
      description: `Returns review count, average rating, and a summary of customer feedback for ${brandName}.`,
      tags: ['reviews', 'ratings', 'reputation', 'social-proof'],
      examples: [
        `What do people say about ${brandName}?`,
        `Is ${brandName} well-reviewed?`,
        `How many reviews does ${brandName} have?`,
      ],
    },
  ];
}

// ---------------------------------------------------------------------
// Human-readable summary of service_area JSONB
// ---------------------------------------------------------------------
function describeServiceArea(area) {
  if (!area || typeof area !== 'object') return '';
  const parts = [];
  if (area.city) parts.push(area.city);
  if (area.state) parts.push(area.state);
  if (Array.isArray(area.offices) && area.offices.length) {
    parts.push(`Offices: ${area.offices.join(', ')}`);
  }
  if (Array.isArray(area.regions) && area.regions.length) {
    parts.push(`Regions: ${area.regions.join(', ')}`);
  }
  if (Array.isArray(area.ships_to) && area.ships_to.length) {
    parts.push(`Ships to: ${area.ships_to.join(', ')}`);
  }
  return parts.join(' — ');
}

// ---------------------------------------------------------------------
// Response helpers
// ---------------------------------------------------------------------
function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
      ...extraHeaders,
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, User-Agent',
  };
}
