/**
 * Lead Stampede — Agent Card Worker
 *
 * Serves A2A-compliant Agent Cards at:
 *   GET /{slug}                              (JSON — convenience path)
 *   GET /{slug}/.well-known/agent-card.json  (JSON — spec-recommended)
 *   GET /{slug}/view                         (HTML — human-readable viewer page)
 *
 * The JSON card is for AI agents. The /view route is a human-readable
 * page you can share with prospects and clients.
 *
 * The card's contents auto-adapt to the client's business_type:
 *   - "service"   → profile, services, availability, reviews
 *   - "ecommerce" → profile, product search, collections, availability, reviews
 *
 * demo_only=true clients are invisible on all public routes.
 */

const CARD_VERSION = '1.3.0';

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
        usage: 'GET /{client-slug} for JSON, /{client-slug}/view for the human page',
        documentation: 'https://leadstampede.io',
      });
    }

    if (url.pathname === '/health') {
      return json({ status: 'ok', timestamp: new Date().toISOString() });
    }

    // Google Search Console verification file
    if (url.pathname === '/google7b48868a212b3f77.html') {
      return new Response('google-site-verification: google7b48868a212b3f77.html', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Booking redirect — must be checked BEFORE parsePath() so 'b' isn't
    // treated as a client slug.
    const bookingMatch = url.pathname.match(/^\/b\/([^/]+)$/);
    if (bookingMatch) {
      return handleBookingRedirect(request, env, ctx, bookingMatch[1]);
    }

    const parsed = parsePath(url.pathname);
    if (!parsed) {
      return json({ error: 'invalid_path', message: 'Expected /{client-slug} or /{client-slug}/view' }, 400);
    }
    const { slug, route } = parsed;

    const client = await fetchClient(slug, env);
    if (!client) {
      if (route === 'html' || route === 'view') {
        return htmlResponse(renderNotFoundPage(slug), 404);
      }
      return json({ error: 'client_not_found', slug }, 404);
    }

    // Branch on route type
    if (route === 'html' || route === 'view') {
      // Fetch featured products for e-commerce clients so the page can render them
      const featuredProducts = client.business_type === 'ecommerce'
        ? await fetchFeaturedProducts(client.id, env)
        : [];

      const html = renderViewerPage(client, featuredProducts, env);

      ctx.waitUntil(
        logCardView({
          clientId: client.id,
          requestingAgent: request.headers.get('User-Agent'),
          sourceIp: request.headers.get('CF-Connecting-IP'),
          responseMs: Date.now() - startedAt,
          env,
        })
      );

      return htmlResponse(html, 200, {
        'Cache-Control': 'public, max-age=300',
      });
    }

    // JSON Agent Card — only via .well-known path
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
      'Cache-Control': 'public, max-age=300',
    });
  },
};

// ---------------------------------------------------------------------
// Path parsing — identifies which route was requested
// Supports:
//   /{slug}                          → { slug, route: 'html' }
//   /{slug}/.well-known/agent-card.json → { slug, route: 'card' }
//   /{slug}/view                     → { slug, route: 'view' }
// ---------------------------------------------------------------------
function parsePath(pathname) {
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return null;

  if (parts.length === 1) {
    return { slug: parts[0], route: 'html' };
  }
  if (parts.length === 2 && parts[1] === 'view') {
    return { slug: parts[0], route: 'view' };
  }
  if (parts.length === 3 && parts[1] === '.well-known' && parts[2] === 'agent-card.json') {
    return { slug: parts[0], route: 'card' };
  }
  return null;
}

// ---------------------------------------------------------------------
// Supabase — public reads filtered to active=true AND demo_only=false.
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
    console.error(`[supabase] clients ${res.status} ${await res.text()}`);
    return null;
  }

  const rows = await res.json();
  return rows[0] || null;
}

async function fetchFeaturedProducts(clientId, env) {
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/products?client_id=eq.${encodeURIComponent(clientId)}&active=eq.true&featured=eq.true&select=*&order=price_cents.desc`,
    {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
    }
  );

  if (!res.ok) {
    console.error(`[supabase] products ${res.status} ${await res.text()}`);
    return [];
  }

  return await res.json();
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
// Booking redirect — /b/{token}
// ---------------------------------------------------------------------
async function handleBookingRedirect(request, env, ctx, token) {
  // 1. Validate token format (12 chars, URL-safe alphabet)
  if (!/^[A-Za-z0-9_-]{12}$/.test(token)) {
    return bookingNotFoundResponse();
  }

  // 2. Look up token in booking_url_tokens
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/booking_url_tokens?token=eq.${encodeURIComponent(token)}&select=id,target_url,expires_at`,
    {
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        Accept: 'application/json',
      },
    }
  );

  if (!res.ok) {
    console.error(`[booking-redirect] token lookup ${res.status} ${await res.text()}`);
    return bookingNotFoundResponse();
  }

  const rows = await res.json();
  const tokenRow = rows[0] || null;

  if (!tokenRow) {
    return bookingNotFoundResponse();
  }

  // 3. Check expiry
  if (new Date(tokenRow.expires_at) < new Date()) {
    return bookingNotFoundResponse();
  }

  // 4. Log click async (don't block redirect)
  ctx.waitUntil(logBookingClick(tokenRow.id, request, env));

  // 5. Redirect
  return new Response(null, {
    status: 302,
    headers: {
      'Location': tokenRow.target_url,
      'Cache-Control': 'no-store',
    },
  });
}

async function logBookingClick(tokenId, request, env) {
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/booking_url_clicks`, {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        token_id: tokenId,
        user_agent: request.headers.get('user-agent') || null,
        referrer: request.headers.get('referer') || null,
        ip_address: request.headers.get('cf-connecting-ip') || null,
        country: request.cf?.country || null,
      }),
    });
  } catch (err) {
    console.error('[booking-redirect] click log failed:', err.message);
  }
}

function bookingNotFoundResponse() {
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Link Expired</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      max-width: 480px; margin: 80px auto; padding: 24px;
      color: #111; line-height: 1.5;
    }
    h1 { font-size: 24px; margin-bottom: 8px; }
    p { color: #555; }
    .footer { margin-top: 32px; font-size: 13px; color: #888; }
  </style>
</head>
<body>
  <h1>This link has expired</h1>
  <p>The booking link you followed is no longer valid. It may have
  expired or been mistyped.</p>
  <p>Please visit the business's website directly, or contact them
  by phone or email to schedule.</p>
  <div class="footer">Powered by Lead Stampede</div>
</body>
</html>`;

  return new Response(html, {
    status: 404,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

// ---------------------------------------------------------------------
// JSON Agent Card builder — routes on business_type
// ---------------------------------------------------------------------
function buildAgentCard(client, env) {
  const mcpBase = env.MCP_BASE_URL || 'http://localhost:3000';
  const businessType = client.business_type || 'service';

  let skills;
  if (businessType === 'ecommerce') {
    skills = buildEcommerceSkills(client);
  } else if (businessType === 'automotive') {
    skills = buildAutomotiveSkills(client);
  } else {
    skills = buildServiceSkills(client);
  }

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

function buildAutomotiveSkills(client) {
  const dealerName = client.business_name;
  const make = client.industry || 'automotive';

  return [
    {
      id: 'get_business_profile',
      name: 'Get Dealership Profile',
      description: `Returns dealership name, location, hours, departments, and contact info for ${dealerName}.`,
      tags: ['profile', 'about', 'dealership', 'automotive', make].filter(Boolean),
      examples: [
        `Tell me about ${dealerName}`,
        `Where is ${dealerName} located?`,
        `How do I contact ${dealerName}?`,
      ],
    },
    {
      id: 'search_inventory',
      name: 'Search Vehicle Inventory',
      description: `Searches the ${dealerName} vehicle inventory by stock type (new/used/certified pre-owned), make, model, year, price range, body type, and fuel type. Optional natural-language query for things like "electric SUV" or "AWD wagon under $40k". Returns matching vehicles with year, make, model, trim, mileage, price, and a link to the listing.`,
      tags: ['inventory', 'vehicles', 'cars', 'search', 'browse', 'automotive', make].filter(Boolean),
      examples: [
        `What new ${make}s does ${dealerName} have under $40k?`,
        `Show me the certified pre-owned SUVs at ${dealerName}`,
        `Does ${dealerName} have any electric vehicles?`,
        `Find me a ${make} wagon at ${dealerName}`,
      ],
    },
    {
      id: 'get_vehicle_details',
      name: 'Get Vehicle Details',
      description: `Returns full details for a specific vehicle in ${dealerName}'s inventory by VIN or stock number: year, make, model, trim, mileage, price, MSRP, features, exterior/interior color, fuel economy, and listing URL.`,
      tags: ['vehicle', 'details', 'specs', 'features', 'automotive', make].filter(Boolean),
      examples: [
        `Tell me more about that ${make} Tiguan`,
        `What features does this vehicle have?`,
        `What's the MSRP on stock number V25-001?`,
      ],
    },
    {
      id: 'get_specials',
      name: 'Get Current Specials',
      description: `Returns ${dealerName}'s current specials and offers — new-vehicle APR/lease specials, pre-owned specials, service & parts coupons, manufacturer rebates, and incentive programs (College Grad, Military). Each offer includes a title, summary, and a link to the dealer's offer page.`,
      tags: ['specials', 'offers', 'deals', 'rebates', 'incentives', 'automotive', make].filter(Boolean),
      examples: [
        `What specials does ${dealerName} have right now?`,
        `Are there any lease deals at ${dealerName}?`,
        `Any service coupons available?`,
        `Does ${dealerName} have a military discount?`,
      ],
    },
    {
      id: 'get_availability',
      name: 'Get Hours and Availability',
      description: `Returns ${dealerName}'s sales, service, and parts department hours. Includes whether online scheduling is available for service appointments.`,
      tags: ['hours', 'availability', 'schedule', 'departments', 'automotive'],
      examples: [
        `When is ${dealerName} open?`,
        `What are ${dealerName}'s service hours?`,
        `Is the parts department open on Saturday?`,
      ],
    },
    {
      id: 'get_reviews',
      name: 'Get Reviews and Reputation',
      description: `Returns review count, average rating, and a summary of customer feedback for ${dealerName}.`,
      tags: ['reviews', 'ratings', 'reputation', 'social-proof', 'automotive'],
      examples: [
        `What do people say about ${dealerName}?`,
        `How many reviews does ${dealerName} have?`,
        `Is ${dealerName} a good dealership?`,
      ],
    },
    {
      id: 'schedule_service_appointment',
      name: 'Schedule a Service Appointment',
      description: `Captures a service appointment request for ${dealerName} — customer info, vehicle (year/make/model/VIN), requested services (oil change, tires, diagnostics, recall work, etc.), and preferred timing. Returns a tracked link to the official online scheduler so the service advisor can confirm the exact slot.`,
      tags: ['service', 'appointment', 'maintenance', 'repair', 'booking', 'automotive', make].filter(Boolean),
      examples: [
        `I need an oil change for my ${make}`,
        `Can I schedule service at ${dealerName}?`,
        `My check engine light is on — book me at ${dealerName}`,
        `When can I bring my Tiguan in for tires?`,
      ],
    },
    {
      id: 'contact_sales',
      name: 'Contact Sales',
      description: `Captures a sales lead for ${dealerName}. Use for test drive requests, vehicle inquiries, financing questions, lease questions, trade-in conversations, or general "I'm interested in this car" requests. Captures customer info, intent (test_drive, vehicle_inquiry, financing, lease, trade_in, general), and the specific vehicle of interest if known. The sales team follows up by the customer's preferred contact method.`,
      tags: ['sales', 'test-drive', 'financing', 'lease', 'trade-in', 'inquiry', 'automotive', make].filter(Boolean),
      examples: [
        `I want to test drive a ${make} ID.4`,
        `Can ${dealerName} give me a finance quote?`,
        `What would my trade-in be worth at ${dealerName}?`,
        `I'm interested in leasing a ${make} Atlas`,
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
// Schema.org JSON-LD builder — structured data for search engines
// Escaping note: the caller (htmlShell) must escape "</" as "<\/" in
// the serialized output before embedding in <script> tags.
// ---------------------------------------------------------------------
function buildSchemaJsonLd(client) {
  const typeMap = {
    service: 'ProfessionalService',
    ecommerce: 'Store',
    automotive: 'AutoDealer',
  };

  const ld = {
    '@context': 'https://schema.org',
    '@type': typeMap[client.business_type] || 'LocalBusiness',
    name: client.business_name,
  };

  if (client.description) ld.description = client.description;
  if (client.website) ld.url = client.website;
  if (client.phone) ld.telephone = client.phone;
  if (client.email) ld.email = client.email;

  // Address from service_area JSONB
  const area = client.service_area;
  if (area && typeof area === 'object') {
    if (area.city || area.state) {
      const addr = { '@type': 'PostalAddress', addressCountry: 'US' };
      if (area.city) addr.addressLocality = area.city;
      if (area.state) addr.addressRegion = area.state;
      ld.address = addr;
    }
    if (Array.isArray(area.regions) && area.regions.length > 0) {
      ld.areaServed = area.regions.map(r => ({ '@type': 'Place', name: r }));
    }
  }

  // Opening hours from hours JSONB
  if (client.hours && typeof client.hours === 'object') {
    const dayMap = {
      mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday',
      fri: 'Friday', sat: 'Saturday', sun: 'Sunday',
    };
    const specs = [];
    for (const [key, label] of Object.entries(dayMap)) {
      const val = client.hours[key];
      if (!val || /closed/i.test(val)) continue;
      const match = val.match(/^(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*[-–]\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)/i);
      if (match) {
        specs.push({
          '@type': 'OpeningHoursSpecification',
          dayOfWeek: label,
          opens: normalizeTime(match[1]),
          closes: normalizeTime(match[2]),
        });
      }
    }
    if (specs.length > 0) ld.openingHoursSpecification = specs;
  }

  // Aggregate rating — only when review_count > 0 and average_rating is non-null
  if (client.review_count > 0 && client.average_rating != null) {
    ld.aggregateRating = {
      '@type': 'AggregateRating',
      ratingValue: client.average_rating,
      reviewCount: client.review_count,
    };
  }

  return ld;
}

// Normalize "9am" / "5:00pm" / "8:30am" → "09:00" / "17:00" / "08:30"
function normalizeTime(raw) {
  const s = raw.trim().toLowerCase();
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!m) return s;
  let h = parseInt(m[1], 10);
  const min = m[2] || '00';
  const period = m[3];
  if (period === 'pm' && h < 12) h += 12;
  if (period === 'am' && h === 12) h = 0;
  return `${String(h).padStart(2, '0')}:${min}`;
}

// ---------------------------------------------------------------------
// HTML renderer — human-readable viewer page
// ---------------------------------------------------------------------
function renderViewerPage(client, featuredProducts, env) {
  const businessType = client.business_type || 'service';
  if (businessType === 'ecommerce') {
    return renderEcommercePage(client, featuredProducts);
  }
  // TODO: dedicated automotive renderer when automotive goes non-demo (SOP §22.6)
  return renderServicePage(client);
}

const SHARED_CSS = `
  :root {
    --bg: #0a0a0a;
    --bg-elevated: #141414;
    --bg-elevated-2: #1a1a1a;
    --border: #2a2a2a;
    --text: #f5f5f5;
    --text-muted: #9a9a9a;
    --text-dim: #6a6a6a;
    --accent: #d4af37;
    --accent-hover: #e4bf47;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: var(--bg);
    color: var(--text);
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    font-size: 16px;
    line-height: 1.5;
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { color: var(--accent-hover); text-decoration: underline; }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 48px 24px 64px; }
  .hero {
    padding-bottom: 32px;
    border-bottom: 1px solid var(--border);
    margin-bottom: 40px;
  }
  .hero h1 {
    font-size: 44px;
    font-weight: 700;
    letter-spacing: -0.02em;
    line-height: 1.1;
    margin-bottom: 12px;
  }
  .hero .tagline {
    font-size: 20px;
    color: var(--text-muted);
    font-weight: 400;
    margin-bottom: 20px;
  }
  .hero .description {
    font-size: 17px;
    color: var(--text-muted);
    max-width: 720px;
    line-height: 1.65;
  }
  .section { margin-bottom: 48px; }
  .section h2 {
    font-size: 13px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: var(--text-dim);
    margin-bottom: 20px;
  }
  .footer {
    margin-top: 80px;
    padding-top: 32px;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
    font-size: 13px;
    color: var(--text-dim);
    flex-wrap: wrap;
    gap: 16px;
  }
  .footer a { color: var(--text-muted); }
  .ai-badge {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    border: 1px solid var(--border);
    border-radius: 999px;
    font-size: 12px;
    color: var(--text-muted);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }
  .ai-badge::before {
    content: "";
    display: inline-block;
    width: 6px; height: 6px;
    border-radius: 50%;
    background: #4ade80;
  }
  @media (max-width: 640px) {
    .wrap { padding: 32px 20px 48px; }
    .hero h1 { font-size: 32px; }
    .hero .tagline { font-size: 17px; }
    .hero .description { font-size: 15px; }
  }
`;

function htmlShell(title, bodyContent, extraCss = '', meta = {}) {
  const descTag = meta.description
    ? `\n<meta name="description" content="${escapeAttr(meta.description)}">`
    : '';
  const ogTags = meta.ogTitle
    ? `\n<meta property="og:title" content="${escapeAttr(meta.ogTitle)}">
<meta property="og:description" content="${escapeAttr(meta.description || '')}">
<meta property="og:url" content="${escapeAttr(meta.canonicalUrl || '')}">
<meta property="og:type" content="website">`
    : '';
  const ldTag = meta.jsonLd
    ? `\n<script type="application/ld+json">${JSON.stringify(meta.jsonLd, null, 2).replace(/<\//g, '<\\/')}</script>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="google-site-verification" content="HtJknT67cZpBBeyL5eMlA9TvJ72z_Ius8gHNpJswru4" />
<title>${escapeHtml(title)}</title>${descTag}${ogTags}${ldTag}
<style>${SHARED_CSS}${extraCss}</style>
</head>
<body>
<div class="wrap">
${bodyContent}
</div>
</body>
</html>`;
}

function renderFooter(client) {
  return `
  <div class="footer">
    <span class="ai-badge">AI-readable profile · <a href="/${escapeHtml(client.slug)}/.well-known/agent-card.json">view raw Agent Card →</a></span>
    <span>Powered by <a href="https://leadstampede.io">Lead Stampede</a></span>
  </div>`;
}

// --- Page meta builder (shared by service + ecommerce renderers) ------

function buildPageMeta(client) {
  const area = client.service_area;
  const city = area && area.city ? area.city : '';
  const state = area && area.state ? area.state : '';
  const location = city && state ? ` in ${city}, ${state}` : city ? ` in ${city}` : state ? ` in ${state}` : '';
  const subtitle = client.tagline || (Array.isArray(client.services) && client.services[0]) || '';

  let title = client.business_name;
  if (subtitle) title += ` \u2014 ${subtitle}`;
  if (location) title += location;
  if (title.length > 60) title = title.slice(0, 57) + '...';

  let description = client.business_name;
  if (subtitle) description += ` \u2014 ${subtitle}`;
  if (location) description += location + '.';
  if (client.review_count > 0 && client.average_rating != null) {
    description += ` Rated ${client.average_rating} from ${client.review_count} reviews.`;
  }
  if (description.length > 160) description = description.slice(0, 157) + '...';

  return {
    description,
    ogTitle: title,
    canonicalUrl: `https://lead-stampede-cards.trey-1cb.workers.dev/${client.slug}`,
    jsonLd: buildSchemaJsonLd(client),
    _title: title,
  };
}

// --- Service business page -------------------------------------------

function renderServicePage(client) {
  const services = Array.isArray(client.services) ? client.services : [];
  const serviceAreaText = describeServiceArea(client.service_area);

  const serviceCards = services.length > 0
    ? `<div class="services-grid">
${services.map(s => `  <div class="service-card">${escapeHtml(typeof s === 'string' ? s : (s.name || ''))}</div>`).join('\n')}
</div>`
    : `<p class="muted-text">Contact us to learn about available services.</p>`;

  const hoursRows = renderHoursTable(client.hours);
  const contactButtons = renderContactButtons(client);

  const extraCss = `
    .services-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .service-card {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 10px;
      padding: 16px 18px;
      font-size: 15px;
      font-weight: 500;
    }
    .info-grid { display: grid; grid-template-columns: 1fr; gap: 32px; }
    @media (min-width: 720px) { .info-grid { grid-template-columns: 1fr 1fr; } }
    .info-block { background: var(--bg-elevated); border: 1px solid var(--border); border-radius: 12px; padding: 24px; }
    .info-block p { color: var(--text-muted); font-size: 15px; }
    .hours-table { width: 100%; border-collapse: collapse; font-size: 14px; }
    .hours-table td { padding: 6px 0; border-bottom: 1px solid var(--border); }
    .hours-table td:first-child { color: var(--text-muted); text-transform: capitalize; }
    .hours-table td:last-child { text-align: right; }
    .hours-table tr:last-child td { border-bottom: none; }
    .contact-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
    .contact-btn {
      display: inline-flex; align-items: center; gap: 8px;
      padding: 10px 16px;
      background: var(--bg-elevated-2);
      border: 1px solid var(--border);
      border-radius: 8px;
      color: var(--text);
      font-size: 14px;
      font-weight: 500;
      transition: border-color 120ms ease, background 120ms ease;
    }
    .contact-btn:hover { border-color: var(--accent); background: #202020; color: var(--text); text-decoration: none; }
    .contact-btn.primary { background: var(--accent); color: #0a0a0a; border-color: var(--accent); }
    .contact-btn.primary:hover { background: var(--accent-hover); }
    .muted-text { color: var(--text-muted); font-size: 15px; }
    .pricing-summary { color: var(--text-muted); font-size: 15px; margin-top: 16px; line-height: 1.6; }
    .review-line { font-size: 15px; color: var(--accent); margin-top: 16px; }
  `;

  const reviewLine = client.review_count > 0 && client.average_rating != null
    ? `<p class="review-line">\u2605 ${escapeHtml(String(client.average_rating))} \u00b7 ${escapeHtml(String(client.review_count))} reviews</p>`
    : '';

  const body = `
  <header class="hero">
    <h1>${escapeHtml(client.business_name)}</h1>
    ${client.tagline ? `<p class="tagline">${escapeHtml(client.tagline)}</p>` : ''}
    ${client.description ? `<p class="description">${escapeHtml(client.description)}</p>` : ''}
    ${reviewLine}
  </header>

  <section class="section">
    <h2>Services</h2>
    ${serviceCards}
    ${client.pricing_summary ? `<p class="pricing-summary">${escapeHtml(client.pricing_summary)}</p>` : ''}
  </section>

  <section class="section">
    <div class="info-grid">
      <div class="info-block">
        <h2>Service Area</h2>
        <p>${escapeHtml(serviceAreaText || 'Contact for service area details.')}</p>
      </div>
      <div class="info-block">
        <h2>Hours</h2>
        ${hoursRows}
      </div>
    </div>
  </section>

  <section class="section">
    <h2>Get in Touch</h2>
    <div class="contact-row">
      ${contactButtons}
    </div>
  </section>

  ${renderFooter(client)}
`;

  const meta = buildPageMeta(client);
  return htmlShell(meta._title, body, extraCss, meta);
}

function renderHoursTable(hours) {
  if (!hours || typeof hours !== 'object') {
    return `<p class="muted-text">Contact for hours.</p>`;
  }
  const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  const dayLabels = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
  const rows = days
    .filter(d => hours[d])
    .map(d => `<tr><td>${dayLabels[d]}</td><td>${escapeHtml(hours[d])}</td></tr>`)
    .join('');
  if (!rows) return `<p class="muted-text">Contact for hours.</p>`;
  const noteRow = hours.note ? `<tr><td colspan="2" style="color: var(--text-dim); padding-top: 12px;">${escapeHtml(hours.note)}</td></tr>` : '';
  return `<table class="hours-table">${rows}${noteRow}</table>`;
}

function renderContactButtons(client) {
  const buttons = [];
  if (client.booking_url) {
    buttons.push(`<a class="contact-btn primary" href="${escapeAttr(client.booking_url)}">Book Online</a>`);
  }
  if (client.phone) {
    buttons.push(`<a class="contact-btn" href="tel:${escapeAttr(client.phone.replace(/[^\d+]/g, ''))}">Call ${escapeHtml(client.phone)}</a>`);
  }
  if (client.email) {
    buttons.push(`<a class="contact-btn" href="mailto:${escapeAttr(client.email)}">Email</a>`);
  }
  if (client.website) {
    buttons.push(`<a class="contact-btn" href="${escapeAttr(client.website)}" target="_blank" rel="noopener">Visit Website</a>`);
  }
  if (client.shop_url && client.shop_url !== client.website) {
    buttons.push(`<a class="contact-btn" href="${escapeAttr(client.shop_url)}" target="_blank" rel="noopener">Shop</a>`);
  }
  return buttons.join('\n      ') || `<span class="muted-text">Contact information not available.</span>`;
}

// --- E-commerce page -------------------------------------------------

function renderEcommercePage(client, featuredProducts) {
  const serviceAreaText = describeServiceArea(client.service_area);

  const productCards = featuredProducts.length > 0
    ? `<div class="products-grid">
${featuredProducts.map(p => renderProductCard(p)).join('\n')}
</div>`
    : `<p class="muted-text">Featured products coming soon.</p>`;

  const shopButton = client.shop_url
    ? `<a class="shop-cta" href="${escapeAttr(client.shop_url)}" target="_blank" rel="noopener">Browse the full shop →</a>`
    : '';

  const extraCss = `
    .hero-meta { display: flex; flex-wrap: wrap; gap: 24px; margin-top: 24px; font-size: 14px; color: var(--text-muted); }
    .hero-meta .meta-label { color: var(--text-dim); text-transform: uppercase; font-size: 11px; letter-spacing: 0.12em; }
    .shop-cta {
      display: inline-block;
      margin-top: 24px;
      font-size: 16px;
      font-weight: 500;
      color: var(--accent);
      border-bottom: 1px solid var(--accent);
      padding-bottom: 2px;
    }
    .shop-cta:hover { border-bottom-color: var(--accent-hover); color: var(--accent-hover); text-decoration: none; }
    .products-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 20px; }
    .product-card {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 12px;
      overflow: hidden;
      transition: border-color 150ms ease, transform 150ms ease;
      display: block;
    }
    .product-card:hover {
      border-color: var(--accent);
      transform: translateY(-2px);
      text-decoration: none;
      color: inherit;
    }
    .product-image {
      aspect-ratio: 3 / 4;
      background: var(--bg-elevated-2);
      overflow: hidden;
      position: relative;
    }
    .product-image img { width: 100%; height: 100%; object-fit: cover; display: block; }
    .product-info { padding: 14px 16px 16px; }
    .product-category {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--text-dim);
      margin-bottom: 4px;
    }
    .product-name {
      font-size: 14px;
      font-weight: 500;
      color: var(--text);
      margin-bottom: 6px;
      line-height: 1.35;
    }
    .product-price {
      font-size: 14px;
      color: var(--accent);
      font-weight: 500;
    }
    .product-out-of-stock {
      color: var(--text-dim);
      font-size: 12px;
      font-style: italic;
    }
    .info-grid-ec { display: grid; grid-template-columns: 1fr; gap: 24px; }
    @media (min-width: 720px) { .info-grid-ec { grid-template-columns: 1fr 1fr; } }
    .info-block-ec {
      background: var(--bg-elevated);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 20px 22px;
    }
    .info-block-ec h3 {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--text-dim);
      margin-bottom: 10px;
    }
    .info-block-ec p { color: var(--text-muted); font-size: 14px; line-height: 1.55; }
    .muted-text { color: var(--text-muted); font-size: 15px; }
    .review-line { font-size: 15px; color: var(--accent); margin-top: 16px; }
  `;

  const reviewLine = client.review_count > 0 && client.average_rating != null
    ? `<p class="review-line">\u2605 ${escapeHtml(String(client.average_rating))} \u00b7 ${escapeHtml(String(client.review_count))} reviews</p>`
    : '';

  const body = `
  <header class="hero">
    <h1>${escapeHtml(client.business_name)}</h1>
    ${client.tagline ? `<p class="tagline">${escapeHtml(client.tagline)}</p>` : ''}
    ${client.description ? `<p class="description">${escapeHtml(client.description)}</p>` : ''}
    ${reviewLine}
    ${shopButton}
    ${serviceAreaText ? `<div class="hero-meta">
      <div><span class="meta-label">Based in · </span>${escapeHtml((client.service_area && (client.service_area.city || client.service_area.state)) || '—')}</div>
    </div>` : ''}
  </header>

  <section class="section">
    <h2>Featured</h2>
    ${productCards}
  </section>

  <section class="section">
    <h2>Shop Information</h2>
    <div class="info-grid-ec">
      ${client.shipping_policy ? `<div class="info-block-ec"><h3>Shipping</h3><p>${escapeHtml(client.shipping_policy)}</p></div>` : ''}
      ${client.return_policy ? `<div class="info-block-ec"><h3>Returns</h3><p>${escapeHtml(client.return_policy)}</p></div>` : ''}
      ${serviceAreaText ? `<div class="info-block-ec"><h3>Ships To</h3><p>${escapeHtml(serviceAreaText)}</p></div>` : ''}
      ${client.email ? `<div class="info-block-ec"><h3>Customer Service</h3><p><a href="mailto:${escapeAttr(client.email)}">${escapeHtml(client.email)}</a></p></div>` : ''}
    </div>
  </section>

  ${renderFooter(client)}
`;

  const meta = buildPageMeta(client);
  return htmlShell(meta._title, body, extraCss, meta);
}

function renderProductCard(product) {
  const price = `$${(product.price_cents / 100).toFixed(2)}`;
  const priceLine = product.in_stock
    ? `<div class="product-price">${price}</div>`
    : `<div class="product-out-of-stock">Sold out</div>`;
  const href = product.product_url || '#';
  const imgSrc = product.image_url || 'https://placehold.co/600x800/1a1a1a/6a6a6a?text=No+Image';
  return `<a class="product-card" href="${escapeAttr(href)}" target="_blank" rel="noopener">
  <div class="product-image"><img src="${escapeAttr(imgSrc)}" alt="${escapeAttr(product.name)}" loading="lazy"></div>
  <div class="product-info">
    <div class="product-category">${escapeHtml(product.category || '')}</div>
    <div class="product-name">${escapeHtml(product.name)}</div>
    ${priceLine}
  </div>
</a>`;
}

function renderNotFoundPage(slug) {
  const body = `
  <div style="padding: 80px 0; text-align: center;">
    <h1 style="font-size: 48px; margin-bottom: 12px;">Not found</h1>
    <p style="color: var(--text-muted); font-size: 16px;">No public profile exists for <code style="color: var(--text);">${escapeHtml(slug)}</code>.</p>
    <p style="margin-top: 32px;"><a href="https://leadstampede.io">Return to Lead Stampede →</a></p>
  </div>`;
  return htmlShell('Not found', body);
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

function htmlResponse(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
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

// ---------------------------------------------------------------------
// HTML escaping — never trust DB data directly in HTML output
// ---------------------------------------------------------------------
function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(s) {
  return escapeHtml(s);
}
