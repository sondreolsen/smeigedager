const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const statusEl = document.querySelector("#status");
const answerTextEl = document.querySelector("#answer-text");
const answerMetaEl = document.querySelector("#answer-meta");
const datalistEl = document.querySelector("#city-options");

const fallbackCities = [
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

let supportedCities = [...fallbackCities];
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

function renderAnswer(payload) {
  answerTextEl.textContent = `${payload.city} hadde ${payload.smeigedager} smeigedager i ${payload.year}.`;
  answerMetaEl.textContent =
    payload.mode === "live"
      ? `Basert på Frost-data fra ${payload.source.name} (${payload.source.id}). Smeigedag betyr maks temperatur over ${payload.criteria.maxTemperatureC} grader og ${payload.criteria.precipitationMm} mm nedbor.`
      : `Viser demo-data til Frost-nokkelen er satt. Smeigedag betyr maks temperatur over ${payload.criteria.maxTemperatureC} grader og ${payload.criteria.precipitationMm} mm nedbor.`;
}

async function loadMeta() {
  try {
    const response = await fetch("/api/meta");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error("Kunne ikke lese appstatus.");
    }

    if (Array.isArray(payload.supportedCities) && payload.supportedCities.length) {
      supportedCities = payload.supportedCities;
    }

    fillDatalist(supportedCities);
    startPlaceholderRotation(supportedCities);

    setStatus(
      payload.mode === "live"
        ? "Klar til sok. Appen bruker ekte Frost-data."
        : "Klar til sok. Appen bruker demo-data til FROST_CLIENT_ID er satt.",
    );
  } catch (_error) {
    fillDatalist(supportedCities);
    startPlaceholderRotation(supportedCities);
    setStatus("Klar til sok.");
  }
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const place = searchInput.value.trim();
  if (!place) {
    return;
  }

  setStatus(`Sjekker smeigedager for ${place}...`);

  try {
    const params = new URLSearchParams({ place });
    const response = await fetch(`/api/smeigedager?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Kunne ikke hente smeigedager.");
    }

    renderAnswer(payload);
    setStatus("Ferdig.");
  } catch (error) {
    answerTextEl.textContent = "Jeg fant ikke et gyldig sted.";
    answerMetaEl.textContent = `Prov en av disse: ${supportedCities.join(", ")}.`;
    setStatus(error.message);
  }
});

loadMeta();
