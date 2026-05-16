const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

loadDotEnv();

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const FROST_CLIENT_ID = process.env.FROST_CLIENT_ID || "";
const FROST_CLIENT_SECRET = process.env.FROST_CLIENT_SECRET || "";
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";
let frostTokenCache = null;

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

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

const SUPPORTED_CITIES = [
  "Arendal",
  "Kristiansand",
  "Oslo",
  "Bergen",
  "Stavanger",
  "Tromso",
  "Bodo",
  "Steinkjer",
  "Trondheim",
  "Molde",
  "Sandnes",
  "Lyngdal",
  "Drammen",
  "Sarpsborg",
  "Hamar",
];

const DEMO_SMEIGE_DAYS = {
  Arendal: 42,
  Kristiansand: 47,
  Oslo: 39,
  Bergen: 24,
  Stavanger: 27,
  Tromso: 11,
  Bodo: 9,
  Steinkjer: 18,
  Trondheim: 21,
  Molde: 16,
  Sandnes: 29,
  Lyngdal: 35,
  Drammen: 34,
  Sarpsborg: 33,
  Hamar: 31,
};

const DEMO_PLACES = [
  {
    id: "SN18700",
    name: "Blindern",
    municipality: "Oslo",
    county: "Oslo",
    lat: 59.9423,
    lon: 10.72,
  },
  {
    id: "SN50540",
    name: "Bergen - Florida",
    municipality: "Bergen",
    county: "Vestland",
    lat: 60.3838,
    lon: 5.3327,
  },
  {
    id: "SN90450",
    name: "Tromso",
    municipality: "Tromso",
    county: "Troms",
    lat: 69.6538,
    lon: 18.9095,
  },
];

function loadDotEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) {
    return;
  }

  const contents = fs.readFileSync(envPath, "utf8");
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const separator = line.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
  });
  res.end(message);
}

function sanitizeStaticPath(urlPath) {
  const rawPath = urlPath === "/" ? "/index.html" : urlPath;
  const normalized = path.normalize(rawPath).replace(/^(\.\.[/\\])+/, "");
  return path.join(PUBLIC_DIR, normalized);
}

function serveStatic(req, res) {
  const filePath = sanitizeStaticPath(new URL(req.url, `http://${req.headers.host}`).pathname);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        sendText(res, 404, "Not found");
        return;
      }
      sendText(res, 500, "Failed to read file");
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
    });
    res.end(content);
  });
}

function buildDemoSeries(from, to) {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  const days = [];

  for (let cursor = new Date(start), i = 0; cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1), i += 1) {
    const precipitation = Number(((Math.sin(i / 2.7) + 1.15) * 2.4).toFixed(1));
    const snow = Number(Math.max(0, 18 - i * 0.5).toFixed(1));
    days.push({
      date: cursor.toISOString().slice(0, 10),
      precipitationMm: i % 6 === 0 ? 0 : precipitation,
      snowDepthCm: snow,
    });
  }

  return days;
}

function summarizeSeries(days, lightPrecipitationLimit) {
  let totalPrecipitation = 0;
  let maxSnowDepth = 0;
  let dryDays = 0;
  let lightPrecipitationDays = 0;

  for (const day of days) {
    const precipitation = Number(day.precipitationMm || 0);
    const snowDepth = Number(day.snowDepthCm || 0);

    totalPrecipitation += precipitation;
    maxSnowDepth = Math.max(maxSnowDepth, snowDepth);

    if (precipitation === 0) {
      dryDays += 1;
    }

    if (precipitation > 0 && precipitation <= lightPrecipitationLimit) {
      lightPrecipitationDays += 1;
    }
  }

  return {
    dayCount: days.length,
    totalPrecipitationMm: Number(totalPrecipitation.toFixed(1)),
    maxSnowDepthCm: Number(maxSnowDepth.toFixed(1)),
    dryDays,
    lightPrecipitationDays,
    lightPrecipitationLimitMm: lightPrecipitationLimit,
  };
}

function normalizeCityName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function canonicalCityName(value) {
  const normalized = normalizeCityName(value);
  return SUPPORTED_CITIES.find((city) => normalizeCityName(city) === normalized) || null;
}

function scoreSourceMatch(query, source) {
  const normalizedQuery = normalizeCityName(query);
  const name = normalizeCityName(source.name);
  const municipality = normalizeCityName(source.municipality);
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

async function fetchFrostJson(url) {
  const headers = {
    Accept: "application/json",
    "User-Agent": `Smeigedager/1.0 ${APP_BASE_URL}`,
  };

  if (FROST_CLIENT_SECRET) {
    const token = await getFrostAccessToken();
    headers.Authorization = `Bearer ${token}`;
  } else {
    const auth = Buffer.from(`${FROST_CLIENT_ID}:`).toString("base64");
    headers.Authorization = `Basic ${auth}`;
  }

  const response = await fetch(url, {
    headers,
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.error?.message || data.detail || "Frost request failed";
    throw new Error(`${response.status} ${message}`);
  }

  return data;
}

async function getFrostAccessToken() {
  if (frostTokenCache && frostTokenCache.expiresAt > Date.now() + 60_000) {
    return frostTokenCache.accessToken;
  }

  const body = new URLSearchParams({
    client_id: FROST_CLIENT_ID,
    client_secret: FROST_CLIENT_SECRET,
    grant_type: "client_credentials",
  });

  const response = await fetch("https://frost.met.no/auth/accessToken", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": `Smeigedager/1.0 ${APP_BASE_URL}`,
    },
    body,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.access_token) {
    const message = payload.error_description || payload.error || "Failed to obtain Frost access token";
    throw new Error(message);
  }

  frostTokenCache = {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Number(payload.expires_in || 86400) * 1000,
  };

  return frostTokenCache.accessToken;
}

async function fetchObservationSeries(sourceId, elementId, timeOffset) {
  const endpoint = new URL("https://frost.met.no/observations/v0.jsonld");
  endpoint.searchParams.set("sources", sourceId);
  endpoint.searchParams.set("referencetime", "2025-01-01/2025-12-31");
  endpoint.searchParams.set("elements", elementId);
  endpoint.searchParams.set("timeoffsets", timeOffset);
  endpoint.searchParams.set("levels", "default");
  endpoint.searchParams.set("qualities", "0,1,2,3,4");

  const payload = await fetchFrostJson(endpoint.toString());
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

async function sourceSupportsSmeigedager(sourceId) {
  const endpoint = new URL("https://frost.met.no/observations/availableTimeSeries/v0.jsonld");
  endpoint.searchParams.set("sources", sourceId);
  endpoint.searchParams.set("referencetime", "2025-01-01/2025-12-31");
  endpoint.searchParams.set("elements", "max(air_temperature P1D),sum(precipitation_amount P1D)");

  try {
    const payload = await fetchFrostJson(endpoint.toString());
    const elementIds = new Set((payload.data || []).map((item) => item.elementId));
    return (
      elementIds.has("max(air_temperature P1D)") &&
      elementIds.has("sum(precipitation_amount P1D)")
    );
  } catch (_error) {
    return false;
  }
}

async function resolveCitySource(city) {
  const endpoint = new URL("https://frost.met.no/sources/v0.jsonld");
  endpoint.searchParams.set("types", "SensorSystem");
  endpoint.searchParams.set("name", `${city}*`);
  endpoint.searchParams.set("fields", "id,name,municipality,county,geometry");

  const payload = await fetchFrostJson(endpoint.toString());
  const candidates = (payload.data || []).slice(0, 12);

  for (const candidate of candidates) {
    if (await sourceSupportsSmeigedager(candidate.id)) {
      return {
        id: candidate.id,
        name: candidate.name,
        municipality: candidate.municipality || "",
        county: candidate.county || "",
      };
    }
  }

  throw new Error(`Fant ingen Frost-stasjon med riktige serier for ${city}.`);
}

async function searchFrostSources(query) {
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

  for (const url of urls) {
    try {
      const payload = await fetchFrostJson(url.toString());
      for (const item of mapFrostPlaces(payload)) {
        collected.set(item.id, item);
      }
    } catch (_error) {
      // Ignore empty or unsupported source searches and continue with the next lookup.
    }
  }

  return [...collected.values()]
    .sort((a, b) => scoreSourceMatch(trimmedQuery, b) - scoreSourceMatch(trimmedQuery, a))
    .slice(0, 20);
}

async function resolvePlaceSource(query) {
  const candidates = await searchFrostSources(query);

  if (!candidates.length) {
    throw new Error("Fant ingen Frost-stasjoner som matcher søket.");
  }

  for (const candidate of candidates) {
    if (await sourceSupportsSmeigedager(candidate.id)) {
      return candidate;
    }
  }

  throw new Error("Fant ingen Frost-stasjon med daglig makstemperatur og nedbør for dette stedet.");
}

async function getSmeigedagerForCity(city) {
  const canonicalCity = canonicalCityName(city);
  if (!canonicalCity) {
    throw new Error("Stedet er ikke i den faste listen.");
  }

  if (!FROST_CLIENT_ID) {
    return {
      mode: "demo",
      city: canonicalCity,
      year: 2025,
      smeigedager: DEMO_SMEIGE_DAYS[canonicalCity],
      criteria: {
        maxTemperatureC: 18,
        precipitationMm: 0,
      },
      source: {
        id: `${canonicalCity.toUpperCase()}-DEMO`,
        name: `${canonicalCity} demo`,
      },
    };
  }

  const source = await resolveCitySource(canonicalCity);
  const [temperatureByDate, precipitationByDate] = await Promise.all([
    fetchObservationSeries(source.id, "max(air_temperature P1D)", "PT18H"),
    fetchObservationSeries(source.id, "sum(precipitation_amount P1D)", "PT6H"),
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

  return {
    mode: "live",
    city: canonicalCity,
    year: 2025,
    smeigedager,
    criteria: {
      maxTemperatureC: 18,
      precipitationMm: 0,
    },
    source,
  };
}

async function getSmeigedagerForQuery(query) {
  const canonicalCity = canonicalCityName(query);
  if (!FROST_CLIENT_ID) {
    if (!canonicalCity) {
      throw new Error("Live-søk krever backend med Frost-nøkkel. Uten backend virker bare de faste eksempelstedene.");
    }
    return getSmeigedagerForCity(canonicalCity);
  }

  const source = await resolvePlaceSource(query);
  const [temperatureByDate, precipitationByDate] = await Promise.all([
    fetchObservationSeries(source.id, "max(air_temperature P1D)", "PT18H"),
    fetchObservationSeries(source.id, "sum(precipitation_amount P1D)", "PT6H"),
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

  return {
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

async function handlePlaceSearch(reqUrl, res) {
  const q = (reqUrl.searchParams.get("q") || "").trim();

  if (q.length < 2) {
    sendJson(res, 400, { error: "Skriv minst to tegn for å søke." });
    return;
  }

  if (!FROST_CLIENT_ID) {
    const query = q.toLowerCase();
    const matches = DEMO_PLACES.filter((place) =>
      `${place.name} ${place.municipality} ${place.county}`.toLowerCase().includes(query),
    );

    sendJson(res, 200, {
      mode: "demo",
      places: matches,
    });
    return;
  }

  try {
    sendJson(res, 200, {
      mode: "live",
      places: await searchFrostSources(q),
    });
  } catch (error) {
    sendJson(res, 502, { error: error.message });
  }
}

function extractObservationValue(entry, elementId) {
  const match = (entry.observations || []).find((observation) => observation.elementId === elementId);
  if (!match) {
    return null;
  }
  return Number(match.value);
}

function mapFrostObservations(payload) {
  return (payload.data || []).map((entry) => ({
    date: String(entry.referenceTime).slice(0, 10),
    precipitationMm: extractObservationValue(entry, "sum(precipitation_amount P1D)") ?? 0,
    snowDepthCm: extractObservationValue(entry, "surface_snow_thickness") ?? null,
  }));
}

async function handleWeather(reqUrl, res) {
  const sourceId = (reqUrl.searchParams.get("sourceId") || "").trim();
  const from = (reqUrl.searchParams.get("from") || "").trim();
  const to = (reqUrl.searchParams.get("to") || "").trim();
  const lightLimit = Number(reqUrl.searchParams.get("light") || "1");

  if (!sourceId || !from || !to) {
    sendJson(res, 400, { error: "sourceId, from og to er påkrevd." });
    return;
  }

  if (!FROST_CLIENT_ID) {
    const days = buildDemoSeries(from, to);
    sendJson(res, 200, {
      mode: "demo",
      sourceId,
      summary: summarizeSeries(days, lightLimit),
      days,
    });
    return;
  }

  try {
    const endpoint = new URL("https://frost.met.no/observations/v0.jsonld");
    endpoint.searchParams.set("sources", sourceId);
    endpoint.searchParams.set("referencetime", `${from}/${to}`);
    endpoint.searchParams.set("elements", "sum(precipitation_amount P1D),surface_snow_thickness");
    endpoint.searchParams.set("timeoffsets", "default");
    endpoint.searchParams.set("levels", "default");
    endpoint.searchParams.set("qualities", "0,1,2,3,4");

    const payload = await fetchFrostJson(endpoint.toString());
    const days = mapFrostObservations(payload);

    sendJson(res, 200, {
      mode: "live",
      sourceId,
      summary: summarizeSeries(days, lightLimit),
      days,
    });
  } catch (error) {
    sendJson(res, 502, { error: error.message });
  }
}

async function handleSmeigedager(reqUrl, res) {
  const place = (reqUrl.searchParams.get("place") || "").trim();
  if (!place) {
    sendJson(res, 400, {
      error: "Skriv inn et sted.",
      featuredCities: FEATURED_CITIES,
    });
    return;
  }

  try {
    const payload = await getSmeigedagerForQuery(place);
    sendJson(res, 200, payload);
  } catch (error) {
    sendJson(res, 502, { error: error.message, featuredCities: FEATURED_CITIES });
  }
}

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (reqUrl.pathname === "/api/meta") {
    sendJson(res, 200, {
      mode: FROST_CLIENT_ID ? "live" : "demo",
      hasFrostClientId: Boolean(FROST_CLIENT_ID),
      hasFrostClientSecret: Boolean(FROST_CLIENT_SECRET),
      appBaseUrl: APP_BASE_URL,
      supportedCities: SUPPORTED_CITIES,
      featuredCities: FEATURED_CITIES,
    });
    return;
  }

  if (reqUrl.pathname === "/health") {
    sendJson(res, 200, {
      ok: true,
      mode: FROST_CLIENT_ID ? "live" : "demo",
    });
    return;
  }

  if (reqUrl.pathname === "/api/places") {
    await handlePlaceSearch(reqUrl, res);
    return;
  }

  if (reqUrl.pathname === "/api/weather") {
    await handleWeather(reqUrl, res);
    return;
  }

  if (reqUrl.pathname === "/api/smeigedager") {
    await handleSmeigedager(reqUrl, res);
    return;
  }

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
