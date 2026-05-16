const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const statusEl = document.querySelector("#status");
const answerTextEl = document.querySelector("#answer-text");
const answerMetaEl = document.querySelector("#answer-meta");
const datalistEl = document.querySelector("#city-options");
const DATA_URL = "./data/smeigedager-2025.json";

let dataset = null;
let supportedCities = [];
let placeholderTimer = null;

function setStatus(message) {
  statusEl.textContent = message;
}

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
  const sequence = shuffle(cities);
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

function renderAnswer(place) {
  answerTextEl.textContent = `${place.name} hadde ${place.smeigedager} smeigedager i ${dataset.year}.`;
  answerMetaEl.textContent = `Basert pa Frost-data fra ${place.source.label}. Smeigedag betyr maks temperatur over ${dataset.criteria.maxTemperatureC} grader og ${dataset.criteria.precipitationMm} mm nedbor.`;
}

async function loadDataset() {
  const response = await fetch(DATA_URL);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error("Kunne ikke lese smeigedager-data.");
  }

  dataset = payload;
  supportedCities = payload.places.map((place) => place.name);
  fillDatalist(supportedCities);
  startPlaceholderRotation(supportedCities);
  setStatus("Klar til sok.");
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const place = searchInput.value.trim();
  if (!place) {
    return;
  }

  setStatus(`Sjekker smeigedager for ${place}...`);

  try {
    const match = findPlace(place);
    if (!match) {
      throw new Error("Velg et sted fra listen.");
    }

    renderAnswer(match);
    setStatus("Ferdig.");
  } catch (error) {
    answerTextEl.textContent = "Jeg fant ikke et gyldig sted.";
    answerMetaEl.textContent = `Prov en av disse: ${supportedCities.join(", ")}.`;
    setStatus(error.message);
  }
});

loadDataset().catch((error) => {
  setStatus(error.message);
  answerTextEl.textContent = "Smeigedager-data kunne ikke lastes.";
  answerMetaEl.textContent = "Prov a laste siden pa nytt.";
});
