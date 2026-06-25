# Gombe Harmattan Dust Storm & Air Quality Digital Twin

## Version 6.0 — Clear Gombe map, smart labels and favicon fix

Version 6 keeps the complete live Harmattan simulation while guaranteeing that the Gombe State boundary and its configured towns/villages remain visible. Data panels now sit outside the central map frame instead of covering it.

### Version 6 improvements

- The map has its own central viewport between the left and right telemetry rails.
- The lower chart deck and map controls are outside the mapped state area.
- `fitBounds` now uses the actual central map dimensions rather than compensating for full-screen overlays.
- The default home view is top-down, north-up and fitted to the complete administrative boundary.
- Enabling ORBIT temporarily tilts the map; disabling it returns to the complete fitted view.
- Every configured Gombe town and village label is kept visible using adaptive placement.
- Labels move through candidate positions and radial searches to avoid one another.
- Leader lines connect displaced labels to their true geographic coordinates.
- Radar station names are hidden until hover so they do not cover town names.
- The duplicate map thermal card and title overlay are removed from the mapped state area; the full readings remain in the dashboard panels.
- A responsive `ResizeObserver` resizes and refits the state when the browser or panel layout changes.
- A real favicon is included, and `/favicon.ico` now resolves successfully instead of returning `404 Not Found`.
- Frontend cache-busting is updated to Version 6 (`?v=6.0.0`).


## Main capabilities

- FastAPI backend with a one-second WebSocket telemetry stream.
- OpenWeather weather observations for temperature, wind, gusts, humidity, pressure, cloud cover, rainfall and visibility.
- OpenAQ v3 PM2.5 and PM10 station ingestion.
- NASA FIRMS VIIRS near-real-time hotspot ingestion.
- Continuously animated dust, wind, heat-haze and radar layers.
- PM, wind, humidity and dust-index-driven atmospheric simulation.
- Live thermal meters, particulate charts and wind/dispersion charts.
- Health, aviation, visibility, dust-loading and thermal-risk indicators.
- Live, mixed and demo data modes.
- Responsive desktop, tablet and mobile layout.
- Automated tests and Docker support.

## Gombe-only spatial behaviour

The browser retrieves the Gombe boundary from:

```text
GET /api/boundary
```

The boundary is then used for five separate controls:

1. A MapLibre polygon mask covers all neighbouring states.
2. A screen-space SVG mask clips animation canvases to the state shape.
3. `maxBounds` constrains map panning to Gombe.
4. Sensor, hotspot, radar and vector coordinates are filtered with point-in-polygon tests.
5. Only curated Gombe towns and villages are labelled.

The system uses the cached geoBoundaries shape when available and an approximate built-in Gombe polygon when the external boundary service is unavailable.

## Severity-responsive dust model

The frontend calculates a visual severity score from:

- 64% derived dust index;
- 25% normalised PM10;
- 11% normalised PM2.5.

The result is constrained to 0–100 and drives the particle system:

```text
particle count = 90 + 2450 × severity_ratio^1.72
radiance      = 7  + 93   × severity_ratio^1.32
```

This gives a deliberately nonlinear response:

- **Low severity:** approximately 90–300 dim points, weak trails and no flash bursts.
- **Moderate severity:** several hundred points with intermittent compact glints.
- **High severity:** more than 1,500 brighter points with frequent point flashes.
- **Extreme severity:** up to approximately 2,540 points with maximum permitted radiance.

Even at extreme severity, point sprites remain small. Town and village labels are rendered on a higher display layer and remain readable.

## Project structure

```text
harmattan_air_quality_twin/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── models.py
│   ├── services/
│   │   ├── air_quality.py
│   │   ├── boundary.py
│   │   ├── firms.py
│   │   ├── metrics.py
│   │   ├── simulator.py
│   │   └── weather.py
│   └── static/
│       ├── index.html
│       ├── css/styles.css
│       └── js/
│           ├── app.js
│           ├── charts.js
│           ├── dust.js
│           ├── heat.js
│           └── wind.js
├── tests/
├── .env.example
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── run.py
```

## Run locally

Python 3.11 or later is recommended.

```powershell
cd A:\harmattan_air_quality_twin
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
python run.py
```

Open:

```text
http://127.0.0.1:8000
```

The application runs in animated demo mode when API keys are blank.

## Enable live data

Edit `.env`:

```dotenv
OPENWEATHER_API_KEY=your_openweather_key
OPENAQ_API_KEY=your_openaq_v3_key
NASA_FIRMS_MAP_KEY=your_firms_map_key

WEATHER_REFRESH_SECONDS=180
AIR_QUALITY_REFRESH_SECONDS=300
FIRMS_REFRESH_SECONDS=600
BROADCAST_INTERVAL_SECONDS=1

GOMBE_BBOX=[10.15,9.45,12.35,11.55]
```

`GOMBE_BBOX` also accepts this form:

```dotenv
GOMBE_BBOX=10.15,9.45,12.35,11.55
```

Restart the application after changing `.env`.

## Browser refresh after upgrading

Stop the old Uvicorn process completely, replace the project folder, copy the existing `.env` into the new folder, and restart:

```text
Ctrl+C
```

```powershell
python run.py
```

Then close the previous browser tab or perform a hard refresh:

```text
Ctrl+F5
```

Version 6 uses `?v=6.0.0` asset URLs and disables frontend caching.

## Controls

- **HOME:** refits the map to the Gombe boundary.
- **DUST:** toggles the severity-responsive point field and PM heatmap.
- **WIND:** toggles wind streamlines and moving wind ribbons.
- **HEAT:** toggles heat haze, hotspot shimmer and thermal layers.
- **RADAR:** toggles the three Gombe radar stations.
- **BOOST:** increases visibility while preserving severity scaling.
- **ORBIT:** enables or disables slow map rotation.

## Tests

Run:

```bash
python -m pytest -q
```

The Version 6 test suite checks:

- configuration parsing;
- simulator and metrics behaviour;
- weather fields;
- required dashboard elements;
- radiant renderers;
- Gombe-only masks and labels;
- severity-responsive particle logic;
- Version 6 cache-busting assets and the favicon route.

## API endpoints

- `GET /api/health` — service status and connected browser count.
- `GET /api/snapshot` — latest telemetry frame.
- `GET /api/boundary` — cached Gombe State GeoJSON.
- `WS /ws/live` — one-second telemetry stream.

## Security

Keep `.env` out of version control. API providers may include keys in request URLs, so do not publish terminal logs containing full API requests. Revoke and regenerate any key that has been exposed.

## Operational note

The risk, heat and aviation indicators are research-oriented decision-support demonstrations. They are not certified medical, environmental or flight-safety products and should not be used as the sole basis for operational decisions.
