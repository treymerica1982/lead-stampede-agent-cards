/**
 * Lead Stampede — Agent Card Worker
 *
 * Serves A2A-compliant Agent Cards at:
 *   GET /{slug}                         (convenience path)
 *   GET /{slug}/.well-known/agent-card.json   (spec-recommended path)
 *
 * Each card describes one SMB client's capabilities and points AI agents
 * at the MCP server where those capabilities are actually executed.
 */

// ---------------------------------------------------------------------
// Constants — update MCP_BASE_URL once the MCP server is deployed to Railway
// ---------------------------------------------------------------------
const CARD_VERSION = '1.0.0';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const startedAt = Date.now();

    // CORS preflight — AI agents calling from browsers need this
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // Only GET is supported
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

    // Health check
    if (url.pathname === '/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // Parse the client slug out of the path
    // Supports both:
    //   /acme-roofing
    //   /acme-roofing/.well-known/agent-card.json
    const slug = extractSlug(url.pathname);
    if (!slug) {
      return json({ error: 'invalid_path', message: 'Expected /{client-slug}' }, 400);
    }

    // Look up the client in Supabase
    const client = await fetchClient(slug, env);
    if (!client) {
      return json(
        { error: 'client_not_found', slug },
        404
      );
    }

    // Build the Agent Card
    const card = buildAgentCard(client, env);

    // Fire-and-forget analytics log
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

  // Case 1: /{slug}
  if (parts.length === 1) {
    return parts[0];
  }

  // Case 2: /{slug}/.well-known/agent-card.json
  if (
    parts.length === 3 &&
    parts[1] === '.well-known' &&
    parts[2] === 'agent-card.json'
  ) {
    return parts[0];
  }

  return null;
}

// ---------------------------------------------------------------------
// Supabase client lookup — uses anon key with public-read RLS policy
// ---------------------------------------------------------------------
async function fetchClient(slug, env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&active=eq.true&select=*`,
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

// ---------------------------------------------------------------------
// Analytics — insert a row into agent_card_views
// ---------------------------------------------------------------------
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
    // Never let analytics failures affect the response
    console.error('[analytics]', err.message);
  }
}

// ---------------------------------------------------------------------
// Agent Card builder — emits an A2A-spec-compliant card
// Spec: https://a2a-protocol.org/latest/specification/
// ---------------------------------------------------------------------
function buildAgentCard(client, env) {
  const mcpBase = env.MCP_BASE_URL || 'http://localhost:3000';
  const serviceAreaText = describeServiceArea(client.service_area);
  const serviceSummary = Array.isArray(client.services) ? client.services.join(', ') : '';

  return {
    name: client.business_name,
    description: client.description,

    provider: {
      organization: 'Lead Stampede',
      url: 'https://leadstampede.io',
    },

    version: CARD_VERSION,
    documentationUrl: client.website || 'https://leadstampede.io',

    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
    },

    defaultInputModes: ['text'],
    defaultOutputModes: ['application/json', 'text'],

    skills: [
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
        description: `Returns the list of services offered by ${client.business_name} and any available pricing information. Services: ${serviceSummary}.`,
        tags: ['services', 'pricing', 'offerings', client.industry].filter(Boolean),
        examples: [
          `What services does ${client.business_name} offer?`,
          `How much does ${client.business_name} charge?`,
          `Does ${client.business_name} do ${Array.isArray(client.services) ? client.services[0] : 'consultations'}?`,
        ],
      },
      {
        id: 'get_availability',
        name: 'Get Availability and Booking',
        description: `Returns business hours and booking options for ${client.business_name}. ${client.booking_url ? 'Online booking is available.' : 'Contact the business directly to schedule.'}`,
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
    ],

    supportedInterfaces: [
      {
        protocolBinding: 'REST',
        url: `${mcpBase}/mcp/tools`,
      },
    ],

    // Lead-Stampede-specific metadata (custom extension)
    metadata: {
      serviceArea: serviceAreaText,
      industry: client.industry,
      businessName: client.business_name,
      tagline: client.tagline,
      clientSlug: client.slug,
    },
  };
}

// ---------------------------------------------------------------------
// Human-readable summary of service area JSONB
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
