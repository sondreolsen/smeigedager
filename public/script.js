const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const answerTextEl = document.querySelector("#answer-text");
const answerMetaEl = document.querySelector("#answer-meta");
const datalistEl = document.querySelector("#city-options");
const APP_CONFIG = window.SMEIGE_APP_CONFIG || {};
const API_BASE_URL = String(APP_CONFIG.apiBaseUrl || "").replace(/\/$/, "");
const DATA_URL = "./data/smeigedager-2025.json";
const FAST_DATA_URL = "./data/remembered-places-2025.json";
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

let dataset = null;
let supportedCities = [...FEATURED_CITIES];
let placeholderTimer = null;

function shuffle(values) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function updatePlaceholder(city) {
  searchInput.placeholder = `${city}?`;
}

function startPlaceholderRotation(cities) {
  const sequence = shuffle(cities.length ? cities : FEATURED_CITIES);
  let index = 0;

  updatePlaceholder(sequence[index]);

  if (placeholderTimer) {
    clearInterval(placeholderTimer);
  }

  placeholderTimer = setInterval(() => {
    index = (index + 1) % sequence.length;
    if (!searchInput.value) {
      updatePlaceholder(sequence[index]);
    }
  }, 1800);
}

function fillDatalist(cities) {
  datalistEl.innerHTML = cities.map((city) => `<option value="${city}"></option>`).join("");
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function findPlace(query) {
  if (!dataset) {
    return null;
  }

  const normalized = normalize(query);
  return dataset.places.find((place) => {
    if (normalize(place.name) === normalized) {
      return true;
    }
    return (place.aliases || []).some((alias) => normalize(alias) === normalized);
  }) || null;
}

function renderAnswerFromDataset(place) {
  answerTextEl.textContent = `${place.name} hadde ${place.smeigedager} smeigedager i ${dataset.year}.`;
  answerMetaEl.textContent = `Basert pa Frost-data fra ${place.source.label}. Smeigedag = Makstemperatur over ${dataset.criteria.maxTemperatureC} grader og ${dataset.criteria.precipitationMm} mm nedbor.`;
}

function renderAnswerFromApi(payload) {
  answerTextEl.textContent = `${payload.city} hadde ${payload.smeigedager} smeigedager i ${payload.year}.`;
  answerMetaEl.textContent = `Basert pa Frost-data fra ${payload.source.name} (${payload.source.id}). Smeigedag = Makstemperatur over ${payload.criteria.maxTemperatureC} grader og ${payload.criteria.precipitationMm} mm nedbor.`;
}

async function fetchJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(payload.error || "Kunne ikke hente data.");
  }

  return payload;
}

async function loadApiMeta() {
  const payload = await fetchJson(`${API_BASE_URL}/api/meta`);
  supportedCities =
    payload.rememberedPlaces ||
    payload.featuredCities ||
    payload.supportedCities ||
    FEATURED_CITIES;
  fillDatalist(supportedCities);
  startPlaceholderRotation(supportedCities);
}

async function loadFastDataset() {
  try {
    dataset = await fetchJson(FAST_DATA_URL);
  } catch (_error) {
    dataset = null;
  }
}

async function loadStaticDataset() {
  const payload = await fetchJson(DATA_URL);
  dataset = payload;
  supportedCities = payload.places.map((place) => place.name);
  fillDatalist(supportedCities);
  startPlaceholderRotation(supportedCities);
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const place = searchInput.value.trim();
  if (!place) {
    return;
  }

  try {
    if (API_BASE_URL) {
      const cachedMatch = findPlace(place);
      if (cachedMatch) {
        renderAnswerFromDataset(cachedMatch);
        return;
      }

      const payload = await fetchJson(`${API_BASE_URL}/api/smeigedager?place=${encodeURIComponent(place)}`);
      renderAnswerFromApi(payload);
      return;
    }

    const match = findPlace(place);
    if (!match) {
      throw new Error("Velg et sted fra listen.");
    }

    renderAnswerFromDataset(match);
  } catch (_error) {
    answerTextEl.textContent = "Jeg fant ikke et gyldig sted.";
    answerMetaEl.textContent = API_BASE_URL
      ? "Prov et annet sted, eller sjekk at backend-URL-en i config.js er riktig."
      : `Prov en av disse: ${supportedCities.join(", ")}.`;
  }
});

 (API_BASE_URL ? Promise.all([loadApiMeta(), loadFastDataset()]) : loadStaticDataset()).catch(() => {
  answerTextEl.textContent = "Smeigedager-data kunne ikke lastes.";
  answerMetaEl.textContent = API_BASE_URL
    ? "Sjekk at backend-URL-en i config.js peker til en levende API."
    : "Prov a laste siden pa nytt.";
});
