# Gombe State Air Quality Visualisation Twin — Version 8.1

## Version 8.1: readable map legend

The map legend has been enlarged for desktop, tablet and mobile use. Legend labels now use higher-contrast 10.5–13 px typography, larger symbols, a thicker AQI colour bar and readable AQI categories. On mobile, AQI categories use a two-column layout and the expanded legend can scroll if the available map height is limited.

A responsive FastAPI and MapLibre environmental visualisation platform for Gombe State. The application streams weather, particulate, thermal-hotspot and modelled atmospheric-flow information through WebSockets and adapts its rendering load to desktop, tablet and mobile devices.

## Version 8 improvements

### Clear map interpretation

- Expandable map legend explaining:
  - glowing blue air-sensor nodes;
  - yellow airborne-particle points;
  - cyan wind streamlines;
  - red thermal hotspots;
  - radar rings;
  - LGA outlines.
- Air-quality severity scale:
  - green: good;
  - yellow: moderate;
  - orange: unhealthy for sensitive groups;
  - red: unhealthy;
  - purple: very unhealthy.
- A live `Last updated: HH:MM:SS UTC+1` timestamp is shown on the dashboard and map.

### Interactive LGA information

The backend now exposes:

```text
GET /api/lgas
```

When administrative polygons are available, all Gombe LGAs are rendered as interactive, severity-coloured areas. A tap or click opens a local information card containing:

- AQI and category;
- PM2.5;
- PM10;
- temperature;
- humidity;
- wind speed and direction;
- health recommendation;
- local update timestamp.

The LGA values are clearly labelled as modelled local estimates derived from the current state-level telemetry. If the external polygon source is unavailable, built-in representative LGA points preserve the tap interaction.

### Mobile map controls

A floating mobile control rail provides:

- zoom in;
- zoom out;
- reset to the complete Gombe State boundary;
- fullscreen map mode.

The mobile map frame is taller so that more of the state and its towns are visible before the user scrolls to the analytical panels.

### Adaptive performance

The browser automatically selects a rendering profile:

- **Desktop:** full visual quality and particle capacity.
- **Tablet:** reduced canvas resolution, particle density, heat packets and wind streams.
- **Mobile:** lower device-pixel ratio, approximately one-third of the desktop particle workload, reduced wind/heat complexity and a 25–30 FPS rendering target.

Additional performance measures include:

- animation suspension while the browser tab is hidden;
- reduced MapLibre pulse frequency on mobile;
- coarser wind-vector grids on smaller screens;
- throttled LGA polygon refreshes;
- disabled map orbit on mobile and tablet;
- disabled expensive backdrop filters and decorative scanlines on small screens;
- frontend cache busting using `?v=8.1.0`.

## Main capabilities

- FastAPI backend.
- One-second WebSocket telemetry stream.
- OpenWeather weather observations.
- OpenAQ PM2.5 and PM10 data.
- NASA FIRMS thermal hotspots.
- Severity-responsive airborne particles.
- Animated wind transport and thermal haze.
- Gombe-only state masking.
- Smart town and village labels.
- Operational, health, aviation and thermal indicators.
- Live, mixed and demo modes.
- Responsive desktop, tablet and mobile layouts.

## Project structure

```text
gombe_state_air_quality_twin/
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
│       ├── favicon.svg
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
├── Procfile
├── Dockerfile
├── docker-compose.yml
├── requirements.txt
└── run.py
```

## Run locally on Windows

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

The platform uses animated demo data when the API keys are blank.

## Live-data environment variables

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

Keep `.env` out of GitHub.

## Render deployment

Build command:

```text
pip install -r requirements.txt
```

Start command:

```text
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

The included `Procfile` contains the same production command.

## Updating the existing GitHub repository

After replacing the local project files while preserving `.env`:

```powershell
git status
git add -A
git commit -m "Add V8 LGA inspector, map legend and mobile performance optimisation"
git pull origin main --rebase
git push origin main
```

Render will redeploy automatically when automatic deployments are enabled.

## API endpoints

- `GET /api/health` — application status.
- `GET /api/snapshot` — latest telemetry frame.
- `GET /api/boundary` — Gombe State boundary.
- `GET /api/lgas` — Gombe LGA polygon data or fallback representative points.
- `WS /ws/live` — live one-second telemetry stream.

## Testing

```powershell
python -m pytest -q
```

The test suite verifies configuration parsing, simulation, metrics, weather fields, Gombe-only masking, radiant rendering, mobile controls, legend and AQI scale, LGA interaction, adaptive rendering, favicon support and API route declarations.

## Operational notice

This is a research and visualisation platform. Its health, aviation, thermal and local LGA estimates are not certified operational measurements and should not be used as the sole basis for medical, environmental or flight-safety decisions.
