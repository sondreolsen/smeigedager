# Smeigedager

En liten prototype for historisk vaer i Norge, laget for desktop og mobil.

## Hva som er bygget

- En responsiv frontend uten byggeverktøy.
- En liten Node-server som serverer appen lokalt og i drift.
- En backend-proxy mot METs `Frost`-API for historiske observasjoner.
- Visning av:
  - total nedbør i millimeter
  - maks snødybde
  - dager uten nedbør
  - dager med lite nedbør

## Hvorfor det er en backend-proxy

MET dokumenterer at `Frost` krever autentisering og ikke er egnet direkte fra en ren browser-klient på grunn av CORS og identifisering. Derfor går frontend via backend.

## MET-APIer som passer til dette prosjektet

### 1. Frost

Brukes til historiske observasjoner og klimadata.

Relevant for denne siden:

- `sources/v0.jsonld`
  - søk etter stasjoner med navn
  - hente geometri og metadata
- `observations/v0.jsonld`
  - hente daglige observasjoner
- `observations/availableTimeSeries/v0.jsonld`
  - verifisere hvilke elementer som finnes for en stasjon før vi viser dem

Elementer som er mest relevante:

- `sum(precipitation_amount P1D)` for daglig nedbør
- `surface_snow_thickness` for snødybde

Avledede nøkkeltall beregnes i appen:

- dager uten nedbør: `precipitation = 0`
- dager med lite nedbør: `0 < precipitation <= terskel`

### 2. Locationforecast

Passer for nåværende vær og prognoser, men ikke for denne hovedoppgaven. METs dokumentasjon sier at historiske prognoser ikke er tilgjengelige fra dette API-et.

### 3. THREDDS

Kan være aktuelt senere hvis vi vil bygge mer avanserte kartlag eller jobbe med større datasett og arkiver. For en enkel historikkside er `Frost` riktig førstevalg.

## Lokal oppstart

1. Kopier `.env.example` til `.env`.
2. Sett ekte `FROST_CLIENT_ID`.
3. Sett `APP_BASE_URL` til riktig URL i produksjon.
4. Start serveren:

```powershell
npm start
```

5. Åpne:

```text
http://localhost:3000
```

## Miljøvariabler

```env
FROST_CLIENT_ID=your-frost-client-id
APP_BASE_URL=https://your-live-domain.example
```

`APP_BASE_URL` brukes også i `User-Agent` mot MET, noe som gjør produksjonsoppsettet ryddigere.

## Demo-modus

Hvis `FROST_CLIENT_ID` ikke er satt, bruker appen demo-data slik at grensesnittet fortsatt kan testes.

## Live publisering

GitHub Pages er ikke nok for denne appen alene, fordi Frost-kallene må gå via backend. Derfor er prosjektet nå klargjort for en Node-host med `render.yaml`.

Forslag til drift:

1. Opprett en ny Web Service i Render fra GitHub-repoet.
2. La Render bruke `render.yaml`.
3. Sett `FROST_CLIENT_ID` som hemmelig miljøvariabel i Render.
4. Sett `APP_BASE_URL` til den faktiske Render-URL-en.

Ekstra endepunkter som er lagt til:

- `/health`
- `/api/meta`

## GitHub-opprydding

Det er også lagt til:

- `.gitignore`
- `.env.example`
- `package.json`
- `render.yaml`

## Neste gode steg

- Koble inn `availableTimeSeries` for å velge beste stasjon og skjule felt som ikke finnes.
- Legge til vanlig stedsøk med geokoding og deretter slå opp nærmeste Frost-stasjon.
- Vise grafer for nedbør og snø over tid.
