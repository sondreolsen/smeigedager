const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

loadDotEnv();

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, "public");
const FROST_CLIENT_ID = process.env.FROST_CLIENT_ID || "";
const APP_BASE_URL = process.env.APP_BASE_URL || "http://localhost:3000";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
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
  });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
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

async function fetchFrostJson(url) {
  const auth = Buffer.from(`${FROST_CLIENT_ID}:`).toString("base64");
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json",
      "User-Agent": `Smeigedager/1.0 ${APP_BASE_URL}`,
    },
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    const message = data.error?.message || data.detail || "Frost request failed";
    throw new Error(`${response.status} ${message}`);
  }

  return data;
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
    const endpoint = new URL("https://frost.met.no/sources/v0.jsonld");
    endpoint.searchParams.set("types", "SensorSystem");
    endpoint.searchParams.set("name", `${q}*`);
    endpoint.searchParams.set("fields", "id,name,municipality,county,geometry");

    const payload = await fetchFrostJson(endpoint.toString());
    sendJson(res, 200, {
      mode: "live",
      places: mapFrostPlaces(payload).slice(0, 8),
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

const server = http.createServer(async (req, res) => {
  const reqUrl = new URL(req.url, `http://${req.headers.host}`);

  if (reqUrl.pathname === "/api/meta") {
    sendJson(res, 200, {
      mode: FROST_CLIENT_ID ? "live" : "demo",
      hasFrostClientId: Boolean(FROST_CLIENT_ID),
      appBaseUrl: APP_BASE_URL,
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

  serveStatic(req, res);
});

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
