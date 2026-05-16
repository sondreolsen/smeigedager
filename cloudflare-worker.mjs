const FEATURED_CITIES = [
  "Arendal",
  "Kristiansand",
  "Oslo",
  "Bergen",
  "Stavanger",
  "Tromsø",
  "Bodø",
  "Steinkjer",
  "Trondheim",
  "Molde",
  "Sandnes",
  "Lyngdal",
  "Drammen",
  "Sarpsborg",
  "Hamar",
];

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Cache-Control": "no-store",
};

const CACHE_VERSION = "2026-05-16-v1";
const SOURCE_MATCH_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const SOURCE_SUPPORT_CACHE_TTL_SECONDS = 60 * 60 * 24 * 30;
const SMEIGEDAGER_CACHE_TTL_SECONDS = 60 * 60 * 12;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return jsonResponse(200, { ok: true });
    }

    if (url.pathname === "/health") {
      return jsonResponse(200, { ok: true, mode: env.FROST_CLIENT_ID ? "live" : "demo" });
    }

    if (url.pathname === "/api/meta") {
      return jsonResponse(200, {
        mode: env.FROST_CLIENT_ID ? "live" : "demo",
        hasFrostClientId: Boolean(env.FROST_CLIENT_ID),
        hasFrostClientSecret: Boolean(env.FROST_CLIENT_SECRET),
        featuredCities: FEATURED_CITIES,
      });
    }

    if (url.pathname === "/api/places") {
      return handlePlaceSearch(url, env);
    }

    if (url.pathname === "/api/smeigedager") {
      return handleSmeigedager(url, env, ctx);
    }

    return jsonResponse(404, { error: "Not found" });
  },
};

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status,
    headers: JSON_HEADERS,
  });
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function getCacheRequest(namespace, key) {
  return new Request(
    `https://smeigedager-cache.internal/${CACHE_VERSION}/${namespace}/${encodeURIComponent(key)}`,
  );
}

async function readWorkerCache(namespace, key) {
  const response = await caches.default.match(getCacheRequest(namespace, key));
  if (!response) {
    return null;
  }

  return response.json().catch(() => null);
}

function writeWorkerCache(namespace, key, payload, ttlSeconds, ctx) {
  const response = new Response(JSON.stringify(payload), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${ttlSeconds}`,
    },
  });

  const operation = caches.default.put(getCacheRequest(namespace, key), response);
  if (ctx) {
    ctx.waitUntil(operation);
    return;
  }

  return operation;
}

function scoreSourceMatch(query, source) {
  const normalizedQuery = normalizeText(query);
  const name = normalizeText(source.name);
  const municipality = normalizeText(source.municipality);
  let score = 0;

  if (name === normalizedQuery) {
    score += 100;
  }
  if (municipality === normalizedQuery) {
    score += 90;
  }
  if (name.startsWith(normalizedQuery)) {
    score += 30;
  }
  if (municipality.startsWith(normalizedQuery)) {
    score += 25;
  }
  if (name.includes(normalizedQuery)) {
    score += 10;
  }
  if (municipality.includes(normalizedQuery)) {
    score += 8;
  }

  return score;
}

async function handlePlaceSearch(url, env) {
  const query = String(url.searchParams.get("q") || "").trim();
  if (query.length < 2) {
    return jsonResponse(400, { error: "Skriv minst to tegn for å søke." });
  }

  if (!env.FROST_CLIENT_ID) {
    return jsonResponse(400, { error: "FROST_CLIENT_ID mangler i Worker secrets." });
  }

  try {
    const places = await searchFrostSources(query, env);
    return jsonResponse(200, {
      mode: "live",
      places,
    });
  } catch (error) {
    return jsonResponse(502, { error: error.message });
  }
}

async function handleSmeigedager(url, env, ctx) {
  const query = String(url.searchParams.get("place") || "").trim();
  if (!query) {
    return jsonResponse(400, {
      error: "Skriv inn et sted.",
      featuredCities: FEATURED_CITIES,
    });
  }

  if (!env.FROST_CLIENT_ID) {
    return jsonResponse(400, { error: "FROST_CLIENT_ID mangler i Worker secrets." });
  }

  try {
    const normalizedQuery = normalizeText(query);
    const cachedPayload = await readWorkerCache("smeigedager", normalizedQuery);
    if (cachedPayload) {
      return jsonResponse(200, cachedPayload);
    }

    const source = await resolvePlaceSourceCached(query, env, ctx);
    const [temperatureByDate, precipitationByDate] = await Promise.all([
      fetchObservationSeries(source.id, "max(air_temperature P1D)", "PT18H", env),
      fetchObservationSeries(source.id, "sum(precipitation_amount P1D)", "PT6H", env),
    ]);

    let smeigedager = 0;
    for (const [date, maxTemperature] of temperatureByDate.entries()) {
      const precipitation = precipitationByDate.get(date);
      if (precipitation === undefined) {
        continue;
      }

      if (maxTemperature > 18 && precipitation === 0) {
        smeigedager += 1;
      }
    }

    const payload = {
      mode: "live",
      city: source.municipality || source.name,
      year: 2025,
      smeigedager,
      criteria: {
        maxTemperatureC: 18,
        precipitationMm: 0,
      },
      source,
    };

    writeWorkerCache("smeigedager", normalizedQuery, payload, SMEIGEDAGER_CACHE_TTL_SECONDS, ctx);
    return jsonResponse(200, payload);
  } catch (error) {
    return jsonResponse(502, {
      error: error.message,
      featuredCities: FEATURED_CITIES,
    });
  }
}

async function fetchFrostJson(url, env) {
  const headers = {
    Accept: "application/json",
    "User-Agent": env.APP_BASE_URL
      ? `Smeigedager/1.0 ${env.APP_BASE_URL}`
      : "Smeigedager/1.0 https://smeigedager.pages.dev",
  };

  if (env.FROST_CLIENT_SECRET) {
    const token = await getFrostAccessToken(env);
    headers.Authorization = `Bearer ${token}`;
  } else {
    const auth = btoa(`${env.FROST_CLIENT_ID}:`);
    headers.Authorization = `Basic ${auth}`;
  }

  const response = await fetch(url, { headers });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.error?.message || data.detail || "Frost request failed";
    throw new Error(`${response.status} ${message}`);
  }

  return data;
}

async function getFrostAccessToken(env) {
  const body = new URLSearchParams({
    client_id: env.FROST_CLIENT_ID,
    client_secret: env.FROST_CLIENT_SECRET,
    grant_type: "client_credentials",
  });

  const response = await fetch("https://frost.met.no/auth/accessToken", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": env.APP_BASE_URL
        ? `Smeigedager/1.0 ${env.APP_BASE_URL}`
        : "Smeigedager/1.0 https://smeigedager.pages.dev",
    },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const message = payload.error_description || payload.error || "Failed to obtain Frost access token";
    throw new Error(message);
  }

  return payload.access_token;
}

function mapFrostPlaces(payload) {
  return (payload.data || []).map((item) => ({
    id: item.id,
    name: item.name,
    municipality: item.municipality || item.municipalityName || "",
    county: item.county || item.countyName || "",
    lat: item.geometry?.coordinates?.[1] ?? null,
    lon: item.geometry?.coordinates?.[0] ?? null,
  }));
}

async function searchFrostSources(query, env) {
  const collected = new Map();
  const trimmedQuery = query.trim();
  const normalizedUpper = trimmedQuery.toUpperCase();

  const urls = [];
  const byName = new URL("https://frost.met.no/sources/v0.jsonld");
  byName.searchParams.set("types", "SensorSystem");
  byName.searchParams.set("name", `${trimmedQuery}*`);
  byName.searchParams.set("fields", "id,name,municipality,county,geometry");
  urls.push(byName);

  const byMunicipality = new URL("https://frost.met.no/sources/v0.jsonld");
  byMunicipality.searchParams.set("types", "SensorSystem");
  byMunicipality.searchParams.set("municipality", normalizedUpper);
  byMunicipality.searchParams.set("fields", "id,name,municipality,county,geometry");
  urls.push(byMunicipality);

  for (const sourceUrl of urls) {
    try {
      const payload = await fetchFrostJson(sourceUrl.toString(), env);
      for (const item of mapFrostPlaces(payload)) {
        collected.set(item.id, item);
      }
    } catch (_error) {
      // Ignore empty result combinations and continue.
    }
  }

  return [...collected.values()]
    .sort((a, b) => scoreSourceMatch(trimmedQuery, b) - scoreSourceMatch(trimmedQuery, a))
    .slice(0, 20);
}

async function sourceSupportsSmeigedager(sourceId, env) {
  const cachedSupport = await readWorkerCache("source-support", sourceId);
  if (typeof cachedSupport === "boolean") {
    return cachedSupport;
  }

  const endpoint = new URL("https://frost.met.no/observations/availableTimeSeries/v0.jsonld");
  endpoint.searchParams.set("sources", sourceId);
  endpoint.searchParams.set("referencetime", "2025-01-01/2025-12-31");
  endpoint.searchParams.set("elements", "max(air_temperature P1D),sum(precipitation_amount P1D)");

  try {
    const payload = await fetchFrostJson(endpoint.toString(), env);
    const elementIds = new Set((payload.data || []).map((item) => item.elementId));
    const isSupported = (
      elementIds.has("max(air_temperature P1D)") &&
      elementIds.has("sum(precipitation_amount P1D)")
    );
    await writeWorkerCache("source-support", sourceId, isSupported, SOURCE_SUPPORT_CACHE_TTL_SECONDS);
    return isSupported;
  } catch (_error) {
    await writeWorkerCache("source-support", sourceId, false, SOURCE_SUPPORT_CACHE_TTL_SECONDS);
    return false;
  }
}

async function resolvePlaceSource(query, env) {
  const candidates = await searchFrostSources(query, env);
  if (!candidates.length) {
    throw new Error("Fant ingen Frost-stasjoner som matcher søket.");
  }

  for (const candidate of candidates) {
    if (await sourceSupportsSmeigedager(candidate.id, env)) {
      return candidate;
    }
  }

  throw new Error("Fant ingen Frost-stasjon med daglig makstemperatur og nedbør for dette stedet.");
}

async function resolvePlaceSourceCached(query, env, ctx) {
  const normalizedQuery = normalizeText(query);
  const cachedSource = await readWorkerCache("source-match", normalizedQuery);
  if (cachedSource) {
    return cachedSource;
  }

  const candidates = await searchFrostSources(query, env);
  if (!candidates.length) {
    throw new Error("Fant ingen Frost-stasjoner som matcher sÃ¸ket.");
  }

  const supportChecks = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      isSupported: await sourceSupportsSmeigedager(candidate.id, env),
    })),
  );

  for (const result of supportChecks) {
    if (result.isSupported) {
      writeWorkerCache("source-match", normalizedQuery, result.candidate, SOURCE_MATCH_CACHE_TTL_SECONDS, ctx);
      return result.candidate;
    }
  }

  throw new Error("Fant ingen Frost-stasjon med daglig makstemperatur og nedbÃ¸r for dette stedet.");
}

async function fetchObservationSeries(sourceId, elementId, timeOffset, env) {
  const endpoint = new URL("https://frost.met.no/observations/v0.jsonld");
  endpoint.searchParams.set("sources", sourceId);
  endpoint.searchParams.set("referencetime", "2025-01-01/2025-12-31");
  endpoint.searchParams.set("elements", elementId);
  endpoint.searchParams.set("timeoffsets", timeOffset);
  endpoint.searchParams.set("levels", "default");
  endpoint.searchParams.set("qualities", "0,1,2,3,4");

  const payload = await fetchFrostJson(endpoint.toString(), env);
  const byDate = new Map();

  for (const entry of payload.data || []) {
    const observation = (entry.observations || []).find((item) => item.elementId === elementId);
    if (!observation) {
      continue;
    }
    byDate.set(String(entry.referenceTime).slice(0, 10), Number(observation.value));
  }

  return byDate;
}
