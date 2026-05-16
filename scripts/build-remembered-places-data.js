const fs = require("fs");
const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const SERVER_PATH = path.join(ROOT_DIR, "server.js");
const OUTPUT_PATH = path.join(ROOT_DIR, "data", "remembered-places-2025.json");
const API_BASE_URL = "https://smeidager-api.sondreolsen.workers.dev";
const CONCURRENCY = 3;
const QUERY_NAME_OVERRIDES = {
  Tromso: "Tromsø",
  Bodo: "Bodø",
  Alesund: "Ålesund",
  Tonsberg: "Tønsberg",
  Gjorvik: "Gjøvik",
  Forde: "Førde",
  Floro: "Florø",
  Drobak: "Drøbak",
  Naerbo: "Nærbø",
  Orsta: "Ørsta",
  Osoyro: "Osøyro",
  Sandnessjoen: "Sandnessjøen",
  Mosjoen: "Mosjøen",
  Svolvaer: "Svolvær",
  Rorvik: "Rørvik",
  Saetre: "Sætre",
  Askoy: "Askøy",
  Kleppesto: "Kleppestø",
  Stjordalshalsen: "Stjørdalshalsen",
  Lillestrom: "Lillestrøm",
  Sogndalsfjaera: "Sogndalsfjøra",
  Fosnavag: "Fosnavåg",
};

function readRememberedPlaces() {
  const source = fs.readFileSync(SERVER_PATH, "utf8");
  const match = source.match(/const REMEMBERED_PLACES = \[(.*?)\];/s);
  if (!match) {
    throw new Error("Fant ikke REMEMBERED_PLACES i server.js");
  }

  const jsonArray = `[${match[1].replace(/,\s*$/, "")}]`;
  return JSON.parse(jsonArray);
}

function uniqueAliases(...values) {
  const seen = new Set();
  const aliases = [];

  for (const value of values) {
    const text = String(value || "").trim();
    if (!text) {
      continue;
    }
    const normalized = text
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    if (seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    aliases.push(text);
  }

  return aliases;
}

async function fetchPlace(place) {
  const query = QUERY_NAME_OVERRIDES[place] || place;
  const response = await fetch(`${API_BASE_URL}/api/smeigedager?place=${encodeURIComponent(query)}`);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(`${place}: ${payload.error || response.statusText}`);
  }

  return {
    year: payload.year,
    criteria: payload.criteria,
    place: {
      name: place,
      aliases: uniqueAliases(place, payload.city, payload.source?.municipality, payload.source?.name),
      smeigedager: payload.smeigedager,
      source: {
        label: `${payload.source.name} (${payload.source.id})`,
      },
    },
  };
}

async function mapWithConcurrency(values, limit, iteratee) {
  const results = new Array(values.length);
  let cursor = 0;

  async function worker() {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await iteratee(values[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => worker()),
  );

  return results;
}

async function main() {
  const rememberedPlaces = readRememberedPlaces();
  console.log(`Building fast data for ${rememberedPlaces.length} remembered places...`);

  const failures = [];
  const results = await mapWithConcurrency(rememberedPlaces, CONCURRENCY, async (place, index) => {
    console.log(`[${index + 1}/${rememberedPlaces.length}] ${place}`);
    try {
      return await fetchPlace(place);
    } catch (error) {
      failures.push({ place, error: error.message });
      console.warn(`Skipping ${place}: ${error.message}`);
      return null;
    }
  });

  const successfulResults = results.filter(Boolean);
  const first = successfulResults[0];
  if (!first) {
    throw new Error("Ingen resultater ble bygget.");
  }

  const output = {
    year: first.year,
    criteria: first.criteria,
    places: successfulResults.map((entry) => entry.place),
  };

  fs.writeFileSync(OUTPUT_PATH, `${JSON.stringify(output, null, 2)}\n`, "utf8");
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`Built ${successfulResults.length} fast places.`);

  if (failures.length) {
    console.warn(`Skipped ${failures.length} places:`);
    for (const failure of failures) {
      console.warn(`- ${failure.place}: ${failure.error}`);
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
