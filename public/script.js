const searchForm = document.querySelector("#search-form");
const searchInput = document.querySelector("#search-input");
const fromInput = document.querySelector("#from-input");
const toInput = document.querySelector("#to-input");
const lightInput = document.querySelector("#light-input");
const statusEl = document.querySelector("#status");
const placesEl = document.querySelector("#places");
const summaryTitleEl = document.querySelector("#summary-title");
const summaryGridEl = document.querySelector("#summary-grid");
const historyBodyEl = document.querySelector("#history-body");

async function loadMeta() {
  try {
    const response = await fetch("/api/meta");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error("Kunne ikke lese appstatus.");
    }

    if (payload.mode === "live") {
      setStatus("Klar til søk. Appen kjører med ekte Frost-data.");
      return;
    }

    setStatus("Klar til søk. Appen kjører i demo-modus til FROST_CLIENT_ID er satt.");
  } catch (_error) {
    setStatus("Klar til søk.");
  }
}

function formatDateInput(date) {
  return date.toISOString().slice(0, 10);
}

function setDefaultDates() {
  const to = new Date();
  const from = new Date();
  from.setDate(to.getDate() - 29);
  fromInput.value = formatDateInput(from);
  toInput.value = formatDateInput(to);
}

function setStatus(message) {
  statusEl.textContent = message;
}

function formatNumber(value, unit) {
  if (value === null || Number.isNaN(value)) {
    return "Ikke tilgjengelig";
  }
  return `${Number(value).toLocaleString("nb-NO", {
    maximumFractionDigits: 1,
  })} ${unit}`;
}

function renderPlaces(places) {
  if (!places.length) {
    placesEl.innerHTML = '<p class="empty-row">Fant ingen stasjoner for dette søket.</p>';
    return;
  }

  placesEl.innerHTML = places
    .map(
      (place) => `
        <button
          class="place-button"
          type="button"
          data-source-id="${place.id}"
          data-place-name="${place.name}"
          data-place-area="${[place.municipality, place.county].filter(Boolean).join(", ")}"
        >
          <div>
            <strong>${place.name}</strong>
            <span>${[place.municipality, place.county].filter(Boolean).join(", ")}</span>
          </div>
          <span class="pill">${place.id}</span>
        </button>
      `,
    )
    .join("");
}

function renderSummary(summary) {
  const items = [
    { label: "Total nedbør", value: formatNumber(summary.totalPrecipitationMm, "mm") },
    { label: "Maks snødybde", value: formatNumber(summary.maxSnowDepthCm, "cm") },
    { label: "Dager uten nedbør", value: `${summary.dryDays} dager` },
    {
      label: `Dager med lite nedbør (<= ${summary.lightPrecipitationLimitMm} mm)`,
      value: `${summary.lightPrecipitationDays} dager`,
    },
  ];

  summaryGridEl.classList.remove("empty");
  summaryGridEl.innerHTML = items
    .map(
      (item) => `
        <article class="metric">
          <p class="metric-label">${item.label}</p>
          <p class="metric-value">${item.value}</p>
        </article>
      `,
    )
    .join("");
}

function renderHistory(days) {
  if (!days.length) {
    historyBodyEl.innerHTML = '<tr><td colspan="3" class="empty-row">Ingen observasjoner i valgt periode.</td></tr>';
    return;
  }

  historyBodyEl.innerHTML = days
    .map(
      (day) => `
        <tr>
          <td>${day.date}</td>
          <td>${formatNumber(day.precipitationMm, "mm")}</td>
          <td>${day.snowDepthCm === null ? "Ikke tilgjengelig" : formatNumber(day.snowDepthCm, "cm")}</td>
        </tr>
      `,
    )
    .join("");
}

async function loadWeather(sourceId, placeName, placeArea) {
  const params = new URLSearchParams({
    sourceId,
    from: fromInput.value,
    to: toInput.value,
    light: lightInput.value,
  });

  setStatus(`Henter historikk for ${placeName}...`);

  const response = await fetch(`/api/weather?${params.toString()}`);
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || "Kunne ikke hente værdata.");
  }

  summaryTitleEl.textContent = `${placeName}${placeArea ? `, ${placeArea}` : ""} • ${payload.mode === "demo" ? "demo" : "live"}`;
  renderSummary(payload.summary);
  renderHistory(payload.days);
  setStatus(`Viser ${payload.days.length} dager for ${placeName}.`);
}

searchForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  setStatus("Søker etter stasjoner...");
  placesEl.innerHTML = "";

  try {
    const params = new URLSearchParams({ q: searchInput.value.trim() });
    const response = await fetch(`/api/places?${params.toString()}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || "Kunne ikke søke etter stasjoner.");
    }

    renderPlaces(payload.places);
    setStatus(
      payload.mode === "demo"
        ? "Viser demoresultater. Legg inn FROST_CLIENT_ID for ekte søk."
        : "Velg en stasjon fra listen under.",
    );
  } catch (error) {
    setStatus(error.message);
  }
});

placesEl.addEventListener("click", async (event) => {
  const button = event.target.closest(".place-button");
  if (!button) {
    return;
  }

  try {
    await loadWeather(
      button.dataset.sourceId,
      button.dataset.placeName,
      button.dataset.placeArea,
    );
  } catch (error) {
    setStatus(error.message);
  }
});

setDefaultDates();
loadMeta();
