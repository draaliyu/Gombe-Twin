# Gombe State Air Quality Visualisation Twin — Version 10.1

A responsive, service-oriented environmental digital twin for Gombe State. It combines live weather, particulate measurements, satellite thermal detections, animated atmospheric visualisation, regional evidence explanations and protected experimental AI forecasting in one FastAPI deployment.

## Service portal

| Service | Page | Main purpose |
|---|---|---|
| Live Twin | `/` | One-second telemetry, animated particulate points, wind flow, heat haze and Gombe-only map |
| Regional Explorer | `/explore` | Select an LGA and inspect source-labelled air-quality, wind and thermal evidence |
| Weather Dynamics | `/weather` | Animated sky, rain, clouds, wind circulation, provider weather-map layers and forecast interpretation |
| Heat Intelligence | `/heat` | Ambient heat, FIRMS thermal anomalies, hotspot proximity, wind alignment and visual meaning |
| Evidence Lab | `/learn` | Educational explanations of what the data can and cannot support |
| AI Forecast | `/predictions` | Provider air-pollution forecast, local experimental model and protected retraining |

The services have separate interfaces and APIs but run in one web process, so only one Render service is needed.

## Version 10.1 improvements

### Live weather dynamics

The Weather Dynamics service is no longer a static collection of cards. It includes:

- a live animated sky whose cloud density follows reported cloud cover;
- cloud drift and atmospheric streamlines driven by reported wind speed and direction;
- rain streaks and animated rain cells driven by current rainfall and forecast precipitation probability;
- condition-specific clear, cloudy, rain, haze and thunderstorm scenes;
- provider weather-map layers for precipitation, clouds, wind, pressure and temperature;
- a Gombe-only map mask and mobile zoom, reset and fullscreen controls;
- current weather interpretations and separate forecast interpretations;
- current temperature, provider feels-like temperature, humidity, pressure, visibility, wind, gust, cloud cover, rainfall and daylight window;
- explicit wording that animated flow is modelled from API vectors and is not Doppler-radar measurement or live video.

OpenWeather map tiles are proxied through the backend so the browser never receives the API key.

### API-grounded interpretation

Interpretations use values already present in the current provider frame or forecast. Cards state:

- the value;
- what the value supports;
- its source;
- whether it is current, forecast, calculated, interpolated or demonstration data;
- important limitations.

Examples include:

- cloud cover and current condition;
- current rainfall versus forecast rainfall;
- wind-from direction versus calculated transport-toward direction;
- pressure change to the next provider forecast point;
- visibility availability;
- weather and particulate context using a transparent coarse-particle screening rule.

The platform uses phrases such as “consistent with” and “may indicate”. It does not claim that the APIs prove dust, smoke, fire cause or local exposure.

### Heat and hotspot intelligence

The Heat Intelligence service keeps two different concepts separate:

1. **Ambient heat** from the state-centre weather observation.
2. **Satellite thermal anomalies** from NASA FIRMS.

The page includes:

- animated heat shimmer and rising embers;
- pulsing FIRMS hotspot auras;
- LGA shading modes for ambient heat, FIRMS anomaly influence and combined visual attention;
- LGA selection and click interaction;
- ambient temperature, provider feels-like value and a calculated apparent-temperature screen;
- hotspot count, total FRP, peak FRP and nearest detection distance;
- wind–hotspot alignment showing whether current downwind transport is geometrically aligned with a selected region;
- source-labelled explanations of what a high heat area could mean;
- clear warnings that FRP is radiant power in megawatts, not air temperature.

The apparent-temperature screen combines temperature, humidity and wind using a Steadman-style outdoor formula. It excludes direct solar radiation and is not an official warning.

The combined attention score is a transparent visualisation index made from:

- apparent-temperature screening;
- distance-weighted FIRMS FRP;
- current state AQI.

It is not an emergency, fire-risk or public-health classification.

### Live atmosphere on all service pages

Regional Explorer, Evidence Lab and AI Forecast now receive a lightweight fixed atmospheric canvas. It updates from the WebSocket frame and displays low-cost cloud, wind and rain motion. The dedicated Weather and Heat pages use their own richer renderers instead of running both systems simultaneously.

### Mobile and performance behaviour

- Native vertical scrolling remains enabled.
- MapLibre cooperative gestures allow one-finger page scrolling and two-finger map movement.
- Weather and heat map frames are taller on mobile.
- Canvas resolution, element count and target frame rate are reduced on small devices.
- Rendering pauses when a visual section is outside the viewport or the browser tab is hidden.
- Reduced-motion users receive lower-frequency animation.
- Weather and heat pages avoid the extra global atmospheric renderer.
- Mobile map controls provide zoom, reset and fullscreen.

## Data sources and interpretation boundaries

### OpenWeather current conditions

Used for the configured Gombe reference coordinate:

- temperature and feels-like temperature;
- humidity and pressure;
- sustained wind, direction and optional gust;
- optional visibility;
- cloud cover;
- one-hour rain field;
- condition description and weather code;
- sunrise and sunset when reported.

### OpenWeather 5-day / 3-hour forecast

Used for future weather cards and forecast interpretation:

- temperature and feels-like temperature;
- humidity and pressure;
- wind and gust;
- cloud cover;
- probability of precipitation;
- 3-hour rain and snow fields;
- condition codes.

### OpenWeather map layers

Allow-listed backend tile proxy layers:

- `precipitation_new`;
- `clouds_new`;
- `wind_new`;
- `pressure_new`;
- `temp_new`.

Provider access may depend on the OpenWeather account and key. If tiles are unavailable, the page continues with the modelled flow visual and labels that state clearly.

### OpenAQ

Used for PM2.5 and PM10 where paired measurements are available. Regional values are direct only where a suitable local station exists; otherwise the platform uses inverse-distance interpolation and displays contributing stations, nearest distance and confidence.

### NASA FIRMS

Used for satellite thermal detections, including location, acquisition time, FRP, brightness and confidence where supplied. A FIRMS hotspot may represent vegetation fire, open burning or another high-temperature source. The API does not determine the cause without local verification.

## Project structure

```text
gombe_state_air_quality_visualisation_twin_v10_full/
├── app/
│   ├── main.py
│   ├── config.py
│   ├── models.py
│   ├── services/
│   │   ├── air_quality.py
│   │   ├── boundary.py
│   │   ├── firms.py
│   │   ├── forecast.py
│   │   ├── heat_insights.py
│   │   ├── history.py
│   │   ├── insights.py
│   │   ├── metrics.py
│   │   ├── prediction.py
│   │   ├── security.py
│   │   ├── simulator.py
│   │   ├── weather.py
│   │   └── weather_insights.py
│   └── static/
│       ├── index.html
│       ├── explore.html
│       ├── weather.html
│       ├── heat.html
│       ├── learn.html
│       ├── predictions.html
│       ├── css/
│       └── js/
├── tests/
├── data/
├── .env.example
├── Procfile
├── Dockerfile
├── requirements.txt
└── run.py
```

## Environment configuration

Create `.env` in the project root:

```dotenv
OPENWEATHER_API_KEY=your_openweather_key
OPENAQ_API_KEY=your_openaq_v3_key
NASA_FIRMS_MAP_KEY=your_firms_map_key

WEATHER_REFRESH_SECONDS=180
AIR_QUALITY_REFRESH_SECONDS=300
FIRMS_REFRESH_SECONDS=600
FORECAST_REFRESH_SECONDS=1800
BROADCAST_INTERVAL_SECONDS=1

GOMBE_BBOX=[10.15,9.45,12.35,11.55]

ADMIN_PASSWORD=
ADMIN_PASSWORD_SHA256=
MODEL_MIN_SAMPLES=24
HISTORY_SAMPLE_SECONDS=300
HISTORY_RETENTION_DAYS=90
DATA_DIR=data
```

Keep `.env` out of GitHub.

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

Main service pages:

```text
http://127.0.0.1:8000/weather
http://127.0.0.1:8000/heat
http://127.0.0.1:8000/explore
http://127.0.0.1:8000/learn
http://127.0.0.1:8000/predictions
```

## Render deployment

Build command:

```text
pip install -r requirements.txt
```

Start command:

```text
uvicorn app.main:app --host 0.0.0.0 --port $PORT
```

Add API keys and the administrator password hash through Render **Environment**.

## Protected model retraining

Prefer a SHA-256 password hash:

```powershell
python -c "import getpass,hashlib; print(hashlib.sha256(getpass.getpass('Admin password: ').encode()).hexdigest())"
```

Set:

```dotenv
ADMIN_PASSWORD_SHA256=your_lowercase_hash
```

Leave `ADMIN_PASSWORD` blank when using the hash.

Retraining endpoint:

```text
POST /api/admin/model/retrain
Authorization: Bearer <administrator password>
```

The local model trains only from eligible stored live observations and refuses training when insufficient data exist.

### Render Free persistence limitation

Render Free web services use ephemeral local storage. The following can disappear after spin-down, restart or redeployment:

```text
data/telemetry.sqlite3
data/air_quality_model.json
```

Use a persistent disk or external database for durable public model history.

## API endpoints

### Platform

- `GET /api/services`
- `GET /api/health`
- `GET /api/snapshot`
- `WS /ws/live`

### Geography and regional evidence

- `GET /api/boundary`
- `GET /api/lgas`
- `GET /api/regions`
- `GET /api/regions/insight?name=Akko`

### Weather dynamics

- `GET /api/weather/forecast`
- `GET /api/weather/insight`
- `GET /api/weather/layers`
- `GET /api/weather/tiles/{layer}/{z}/{x}/{y}.png`

### Heat intelligence

- `GET /api/heat/summary`
- `GET /api/heat/regions`
- `GET /api/heat/region?name=Akko`

### Forecasting and administrator

- `GET /api/predictions/status`
- `GET /api/predictions/forecast?hours=8`
- `POST /api/admin/model/retrain`

## Update the existing GitHub deployment

Copy the new project files over the existing repository while preserving `.git`, `.env` and `.venv`.

```powershell
cd A:\harmattan_air_quality_twin

git status
git add -A
git commit -m "Add live weather dynamics and heat hotspot intelligence"
git pull origin main --rebase
git push origin main
```

Render redeploys automatically when auto-deploy is enabled.

After deployment, use a hard refresh:

```text
Ctrl + F5
```

## Testing

```powershell
python -m pytest -q
```

Version 10.1 includes 43 automated tests covering:

- configuration and bounding-box parsing;
- derived metrics and simulation;
- weather availability flags and extended provider fields;
- regional interpolation and provenance;
- animated weather interfaces and tile proxy declarations;
- apparent-temperature and heat-region calculations;
- heat page visual controls and API routes;
- mobile/responsive features;
- AI model and administrator security behaviour;
- HTML and static-dashboard requirements.

## Operational notice

This is a research and visualisation platform. Air-quality, dust-screening, heat, thermal-anomaly, aviation and AI outputs are not certified operational products. They must not be the sole basis for medical, public-health, emergency-response, fire-response or flight-safety decisions.
