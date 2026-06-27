import { compassDirection, connectLive, formatDateTime, initialisePortal, setText } from "./portal.js?v=10.1.0";

initialisePortal();

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
}

function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function ageLabel(value) {
    if (!value) return "Unknown";
    const seconds = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
    if (seconds < 90) return `${Math.round(seconds)} sec`;
    if (seconds < 5400) return `${Math.round(seconds / 60)} min`;
    return `${(seconds / 3600).toFixed(1)} hr`;
}

function weatherGroup(condition = "") {
    const text = String(condition).toLowerCase();
    if (text.includes("thunder")) return "thunderstorm";
    if (text.includes("rain") || text.includes("drizzle") || text.includes("shower")) return "rain";
    if (text.includes("snow") || text.includes("sleet")) return "snow";
    if (text.includes("mist") || text.includes("fog") || text.includes("haze") || text.includes("dust") || text.includes("smoke")) return "haze";
    if (text.includes("cloud") || text.includes("overcast")) return "clouds";
    return "clear";
}

class WeatherSkyRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.context = canvas.getContext("2d", { alpha: true });
        this.stage = canvas.parentElement;
        this.state = { cloud: 20, rain: 0, rainProbability: 0, windSpeed: 2, windDirection: 45, humidity: 40, pressure: 1010, temperature: 30, condition: "clear" };
        this.mobile = window.matchMedia("(max-width: 700px)").matches;
        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        this.targetInterval = 1000 / (this.reducedMotion ? 8 : this.mobile ? 24 : 38);
        this.lastTime = 0;
        this.visible = true;
        this.clouds = [];
        this.drops = [];
        this.windLines = [];
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.stage);
        new IntersectionObserver((entries) => { this.visible = entries[0]?.isIntersecting ?? true; }, { rootMargin: "100px" }).observe(this.stage);
        this.seed();
        this.resize();
        requestAnimationFrame((time) => this.animate(time));
    }

    seed() {
        const cloudCount = this.mobile ? 10 : 18;
        const dropCount = this.mobile ? 95 : 180;
        const windCount = this.mobile ? 28 : 54;
        this.clouds = Array.from({ length: cloudCount }, () => ({
            x: Math.random() * 1.3 - 0.15,
            y: Math.random() * 0.62,
            scale: 0.55 + Math.random() * 1.2,
            speed: 0.12 + Math.random() * 0.23,
            depth: 0.3 + Math.random() * 0.7,
        }));
        this.drops = Array.from({ length: dropCount }, () => ({
            x: Math.random(), y: Math.random(), speed: 0.55 + Math.random() * 1.25, length: 8 + Math.random() * 18,
        }));
        this.windLines = Array.from({ length: windCount }, () => ({
            x: Math.random(), y: Math.random(), speed: 0.45 + Math.random() * 1.1, length: 28 + Math.random() * 68, phase: Math.random() * Math.PI * 2,
        }));
    }

    resize() {
        const rect = this.stage.getBoundingClientRect();
        this.width = Math.max(1, rect.width);
        this.height = Math.max(1, rect.height);
        const dpr = Math.min(window.devicePixelRatio || 1, this.mobile ? 1 : 1.5);
        this.canvas.width = Math.round(this.width * dpr);
        this.canvas.height = Math.round(this.height * dpr);
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;
        this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    update(weather = {}, insight = null) {
        const visual = insight?.visual_state || {};
        this.state = {
            cloud: clamp(visual.cloud_cover_pct ?? weather.cloud_cover_pct ?? 20, 0, 100),
            rain: Math.max(0, Number(visual.rain_mm_1h ?? weather.precipitation_mm_1h) || 0),
            rainProbability: clamp(visual.forecast_rain_probability_pct ?? 0, 0, 100),
            windSpeed: Math.max(0.2, Number(visual.wind_speed_ms ?? weather.wind_speed_ms) || 2),
            windDirection: Number(visual.wind_direction_deg ?? weather.wind_direction_deg) || 45,
            humidity: clamp(visual.humidity_pct ?? weather.humidity_pct ?? 40, 0, 100),
            pressure: Number(visual.pressure_hpa ?? weather.pressure_hpa) || 1010,
            temperature: Number(visual.temperature_c ?? weather.temperature_c) || 30,
            condition: visual.condition_group || weatherGroup(weather.condition),
        };
        this.stage.dataset.weather = this.state.condition;
    }

    drawCloud(cloud, dt, windX, windSpeed, cloudFactor) {
        cloud.x += windX * windSpeed * cloud.speed * dt * 0.000014;
        if (cloud.x > 1.35) cloud.x = -0.35;
        if (cloud.x < -0.35) cloud.x = 1.35;
        const x = cloud.x * this.width;
        const y = (0.06 + cloud.y * 0.82) * this.height;
        const size = Math.min(this.width, this.height) * 0.115 * cloud.scale;
        const alpha = (0.05 + cloudFactor * 0.35) * cloud.depth;
        const context = this.context;
        context.save();
        context.globalAlpha = alpha;
        context.filter = `blur(${this.mobile ? 5 : 9}px)`;
        context.fillStyle = this.state.condition === "thunderstorm" ? "rgba(92,111,128,.94)" : "rgba(222,239,244,.94)";
        context.beginPath();
        context.ellipse(x, y, size * 0.85, size * 0.27, 0, 0, Math.PI * 2);
        context.ellipse(x - size * 0.26, y - size * 0.14, size * 0.38, size * 0.31, 0, 0, Math.PI * 2);
        context.ellipse(x + size * 0.18, y - size * 0.17, size * 0.44, size * 0.35, 0, 0, Math.PI * 2);
        context.fill();
        context.restore();
    }

    draw(time, dt) {
        const context = this.context;
        const state = this.state;
        const radians = ((state.windDirection + 180) * Math.PI) / 180;
        const windX = Math.sin(radians);
        const windY = -Math.cos(radians);
        const cloudFactor = state.cloud / 100;
        const rainFactor = clamp(state.rain / 5 + state.rainProbability / 230 + (state.condition === "rain" || state.condition === "thunderstorm" ? 0.18 : 0), 0, 1);
        const localHour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", hour12: false }).format(new Date()));
        const night = localHour < 6 || localHour >= 19;
        const gradients = night
            ? ["#07111f", "#0d2638", "#0a1824"]
            : state.condition === "thunderstorm"
                ? ["#26323f", "#162837", "#091722"]
                : state.condition === "rain"
                    ? ["#35586c", "#17384c", "#0a1c29"]
                    : state.condition === "haze"
                        ? ["#8b6d52", "#4b4f4f", "#152733"]
                        : ["#187ba2", "#2a91aa", "#0c3147"];
        const background = context.createLinearGradient(0, 0, 0, this.height);
        background.addColorStop(0, gradients[0]);
        background.addColorStop(0.52, gradients[1]);
        background.addColorStop(1, gradients[2]);
        context.fillStyle = background;
        context.fillRect(0, 0, this.width, this.height);

        const orbX = this.width * 0.78;
        const orbY = this.height * 0.22;
        const orbRadius = Math.min(this.width, this.height) * 0.09;
        const orb = context.createRadialGradient(orbX, orbY, 0, orbX, orbY, orbRadius * 2.8);
        orb.addColorStop(0, night ? "rgba(222,238,255,.9)" : "rgba(255,238,173,.94)");
        orb.addColorStop(0.28, night ? "rgba(168,201,239,.28)" : "rgba(255,180,76,.34)");
        orb.addColorStop(1, "rgba(255,255,255,0)");
        context.fillStyle = orb;
        context.beginPath(); context.arc(orbX, orbY, orbRadius * 2.8, 0, Math.PI * 2); context.fill();

        for (const cloud of this.clouds) this.drawCloud(cloud, dt, windX, state.windSpeed, cloudFactor);

        context.save();
        context.lineCap = "round";
        for (const line of this.windLines) {
            const velocity = (0.000025 + state.windSpeed * 0.000009) * line.speed * dt;
            line.x += windX * velocity;
            line.y += windY * velocity;
            if (line.x > 1.1) line.x = -0.1;
            if (line.x < -0.1) line.x = 1.1;
            if (line.y > 1.1) line.y = -0.1;
            if (line.y < -0.1) line.y = 1.1;
            const x = line.x * this.width;
            const y = line.y * this.height;
            const length = line.length * (0.45 + Math.min(state.windSpeed, 14) / 11);
            const gradient = context.createLinearGradient(x - windX * length, y - windY * length, x, y);
            gradient.addColorStop(0, "rgba(138,246,240,0)");
            gradient.addColorStop(1, `rgba(156,255,248,${0.18 + 0.22 * Math.sin(time * 0.002 + line.phase) ** 2})`);
            context.strokeStyle = gradient;
            context.lineWidth = this.mobile ? 0.9 : 1.3;
            context.beginPath();
            context.moveTo(x - windX * length, y - windY * length);
            context.quadraticCurveTo(x - windX * length * 0.5 + Math.sin(time * 0.001 + line.phase) * 9, y - windY * length * 0.5, x, y);
            context.stroke();
        }
        context.restore();

        if (rainFactor > 0.015) {
            const active = Math.max(4, Math.round(this.drops.length * rainFactor));
            context.save();
            context.strokeStyle = `rgba(134,203,255,${0.16 + rainFactor * 0.44})`;
            context.lineWidth = this.mobile ? 0.75 : 1.1;
            for (let index = 0; index < active; index += 1) {
                const drop = this.drops[index];
                drop.x += (windX * 0.00015 + 0.000025) * dt * drop.speed;
                drop.y += 0.00072 * dt * drop.speed;
                if (drop.y > 1.12 || drop.x > 1.12 || drop.x < -0.12) {
                    drop.y = -0.08;
                    drop.x = Math.random();
                }
                const x = drop.x * this.width;
                const y = drop.y * this.height;
                context.beginPath();
                context.moveTo(x, y);
                context.lineTo(x - windX * drop.length * 0.4, y - drop.length);
                context.stroke();
            }
            context.restore();
        }

        const pressurePulse = (Math.sin(time * 0.0012) + 1) / 2;
        context.strokeStyle = `rgba(130,229,222,${0.05 + pressurePulse * 0.08})`;
        context.lineWidth = 1;
        context.beginPath();
        context.arc(this.width * 0.22, this.height * 0.34, 42 + pressurePulse * 24 + Math.abs(state.pressure - 1013) * 0.3, 0, Math.PI * 2);
        context.stroke();

        if (state.condition === "thunderstorm" && Math.sin(time * 0.0031) > 0.994) {
            context.fillStyle = "rgba(237,250,255,.45)";
            context.fillRect(0, 0, this.width, this.height);
        }
    }

    animate(time) {
        const elapsed = time - this.lastTime;
        if (this.visible && !document.hidden && elapsed >= this.targetInterval) {
            this.draw(time, Math.min(elapsed || this.targetInterval, 80));
            this.lastTime = time;
        }
        requestAnimationFrame((next) => this.animate(next));
    }
}

class WeatherMapFlowRenderer {
    constructor(canvas, map) {
        this.canvas = canvas;
        this.map = map;
        this.context = canvas.getContext("2d", { alpha: true });
        this.frame = null;
        this.insight = null;
        this.boundary = null;
        this.mobile = window.matchMedia("(max-width: 700px)").matches;
        this.targetInterval = 1000 / (this.mobile ? 22 : 34);
        this.lastTime = 0;
        this.visible = true;
        this.particles = Array.from({ length: this.mobile ? 44 : 92 }, () => this.newParticle());
        this.rainCells = Array.from({ length: this.mobile ? 26 : 58 }, () => this.newParticle(true));
        new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
        new IntersectionObserver((entries) => { this.visible = entries[0]?.isIntersecting ?? true; }, { rootMargin: "120px" }).observe(canvas.parentElement);
        map.on("resize", () => this.resize());
        map.on("move", () => this.resize());
        this.resize();
        requestAnimationFrame((time) => this.animate(time));
    }

    newParticle(rain = false) {
        return { x: Math.random(), y: Math.random(), speed: 0.45 + Math.random() * 1.1, phase: Math.random() * Math.PI * 2, length: rain ? 8 + Math.random() * 10 : 16 + Math.random() * 32 };
    }

    resize() {
        const rect = this.canvas.parentElement.getBoundingClientRect();
        this.width = Math.max(1, rect.width);
        this.height = Math.max(1, rect.height);
        const dpr = Math.min(window.devicePixelRatio || 1, this.mobile ? 1 : 1.4);
        this.canvas.width = Math.round(this.width * dpr);
        this.canvas.height = Math.round(this.height * dpr);
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;
        this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    update(frame, insight) {
        this.frame = frame;
        this.insight = insight;
    }

    setBoundary(boundary) {
        this.boundary = boundary;
    }

    traceGeometry(geometry) {
        const context = this.context;
        const traceRing = (ring) => {
            ring.forEach((coordinate, index) => {
                const point = this.map.project(coordinate);
                if (index === 0) context.moveTo(point.x, point.y); else context.lineTo(point.x, point.y);
            });
            context.closePath();
        };
        if (geometry.type === "Polygon") geometry.coordinates.forEach(traceRing);
        if (geometry.type === "MultiPolygon") geometry.coordinates.forEach((polygon) => polygon.forEach(traceRing));
    }

    clipToBoundary() {
        const feature = this.boundary?.features?.[0];
        if (!feature?.geometry) return false;
        this.context.beginPath();
        this.traceGeometry(feature.geometry);
        this.context.clip("evenodd");
        return true;
    }

    draw(time, dt) {
        const context = this.context;
        context.clearRect(0, 0, this.width, this.height);
        if (!this.frame) return;
        const weather = this.frame.weather || {};
        const visual = this.insight?.visual_state || {};
        const direction = Number(visual.transport_direction_deg ?? ((Number(weather.wind_direction_deg) || 0) + 180)) || 180;
        const radians = (direction * Math.PI) / 180;
        const dx = Math.sin(radians);
        const dy = -Math.cos(radians);
        const speed = Math.max(0.5, Number(weather.wind_speed_ms) || 2);
        const rain = Math.max(0, Number(weather.precipitation_mm_1h) || 0);
        const probability = clamp(visual.forecast_rain_probability_pct ?? 0, 0, 100);
        const rainFactor = clamp(rain / 5 + probability / 250, 0, 1);

        context.save();
        this.clipToBoundary();
        context.globalCompositeOperation = "screen";
        for (const particle of this.particles) {
            const velocity = (0.000035 + speed * 0.000012) * particle.speed * dt;
            particle.x += dx * velocity;
            particle.y += dy * velocity;
            if (particle.x > 1.05) particle.x = -0.05;
            if (particle.x < -0.05) particle.x = 1.05;
            if (particle.y > 1.05) particle.y = -0.05;
            if (particle.y < -0.05) particle.y = 1.05;
            const x = particle.x * this.width;
            const y = particle.y * this.height;
            const length = particle.length * (0.55 + Math.min(speed, 14) / 12);
            const gradient = context.createLinearGradient(x - dx * length, y - dy * length, x, y);
            gradient.addColorStop(0, "rgba(43,224,220,0)");
            gradient.addColorStop(1, `rgba(85,255,247,${0.42 + 0.22 * Math.sin(time * 0.002 + particle.phase) ** 2})`);
            context.strokeStyle = gradient;
            context.lineWidth = this.mobile ? 1 : 1.35;
            context.beginPath();
            context.moveTo(x - dx * length, y - dy * length);
            context.quadraticCurveTo(x - dx * length * 0.45 + Math.sin(time * 0.001 + particle.phase) * 5, y - dy * length * 0.45, x, y);
            context.stroke();
            context.fillStyle = "rgba(180,255,250,.78)";
            context.beginPath(); context.arc(x, y, this.mobile ? 1.25 : 1.7, 0, Math.PI * 2); context.fill();
        }

        if (rainFactor > 0.02) {
            const active = Math.max(4, Math.round(this.rainCells.length * rainFactor));
            context.strokeStyle = `rgba(83,154,255,${0.32 + rainFactor * 0.48})`;
            context.lineWidth = 1.1;
            for (let index = 0; index < active; index += 1) {
                const drop = this.rainCells[index];
                drop.x += dx * 0.00008 * dt * drop.speed;
                drop.y += 0.00055 * dt * drop.speed;
                if (drop.y > 1.05 || drop.x > 1.05 || drop.x < -0.05) {
                    drop.y = -0.04; drop.x = Math.random();
                }
                const x = drop.x * this.width;
                const y = drop.y * this.height;
                context.beginPath(); context.moveTo(x, y); context.lineTo(x - dx * drop.length * 0.25, y - drop.length); context.stroke();
            }
        }

        const pulse = (time % 3500) / 3500;
        context.strokeStyle = `rgba(255,255,255,${0.16 * (1 - pulse)})`;
        context.lineWidth = 1.2;
        context.beginPath(); context.arc(this.width * 0.5, this.height * 0.5, 30 + pulse * Math.min(this.width, this.height) * 0.42, 0, Math.PI * 2); context.stroke();
        context.restore();
    }

    animate(time) {
        const elapsed = time - this.lastTime;
        if (this.visible && !document.hidden && elapsed >= this.targetInterval) {
            this.draw(time, Math.min(elapsed || this.targetInterval, 80));
            this.lastTime = time;
        }
        requestAnimationFrame((next) => this.animate(next));
    }
}

const skyRenderer = new WeatherSkyRenderer(document.getElementById("weather-sky-canvas"));
const pageState = { frame: null, insight: null, forecast: [], boundary: null, mapBounds: null, activeLayer: "precipitation", layerAvailable: false };

const weatherMap = new maplibregl.Map({
    container: "weather-radar-map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [11.24, 10.43],
    zoom: 7.45,
    pitch: 0,
    bearing: 0,
    cooperativeGestures: true,
    renderWorldCopies: false,
    attributionControl: false,
    fadeDuration: 0,
});
const mapFlow = new WeatherMapFlowRenderer(document.getElementById("weather-map-flow"), weatherMap);

function allCoordinates(geometry) {
    if (!geometry) return [];
    if (geometry.type === "Point") return [geometry.coordinates];
    if (geometry.type === "Polygon") return geometry.coordinates.flat();
    if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
    return [];
}

function outsideMask(boundary) {
    const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
    const holes = [];
    for (const feature of boundary.features || []) {
        const geometry = feature.geometry;
        if (geometry?.type === "Polygon" && geometry.coordinates?.[0]) holes.push(geometry.coordinates[0]);
        if (geometry?.type === "MultiPolygon") geometry.coordinates.forEach((polygon) => polygon?.[0] && holes.push(polygon[0]));
    }
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, ...holes] } }] };
}

function fitBoundary(boundary, duration = 0) {
    const coordinates = (boundary.features || []).flatMap((feature) => allCoordinates(feature.geometry));
    if (!coordinates.length) return;
    const bounds = coordinates.reduce((box, coordinate) => box.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
    pageState.mapBounds = bounds;
    weatherMap.fitBounds(bounds, { padding: window.innerWidth < 700 ? 26 : 50, maxZoom: 9, duration });
}

async function initialiseWeatherMap() {
    const response = await fetch("/api/boundary", { cache: "no-store" });
    const boundary = await response.json();
    pageState.boundary = boundary;
    weatherMap.addSource("weather-gombe", { type: "geojson", data: boundary });
    weatherMap.addLayer({ id: "weather-gombe-fill", type: "fill", source: "weather-gombe", paint: { "fill-color": "#071922", "fill-opacity": 0.12 } });
    weatherMap.addLayer({ id: "weather-gombe-line", type: "line", source: "weather-gombe", paint: { "line-color": "#c9fff8", "line-width": 2.2, "line-opacity": 0.94 } });
    weatherMap.addSource("weather-outside-mask", { type: "geojson", data: outsideMask(boundary) });
    weatherMap.addLayer({ id: "weather-outside-mask", type: "fill", source: "weather-outside-mask", paint: { "fill-color": "#020a10", "fill-opacity": 0.91 } });
    weatherMap.moveLayer("weather-gombe-line");
    fitBoundary(boundary);
    mapFlow.setBoundary(boundary);
    await checkWeatherLayers();
    applyWeatherLayer(pageState.activeLayer);
}

async function checkWeatherLayers() {
    try {
        const response = await fetch("/api/weather/layers", { cache: "no-store" });
        const result = await response.json();
        pageState.layerAvailable = Boolean(result.available);
        setText("weather-layer-status", result.available ? "PROVIDER LAYERS LIVE" : "FLOW VISUAL ONLY");
        if (!result.available) setText("weather-map-note", `${result.flow_notice} Provider tiles require an enabled OpenWeather map key.`);
    } catch (error) {
        pageState.layerAvailable = false;
        setText("weather-layer-status", "LAYER CHECK FAILED");
    }
}

function removeWeatherLayer() {
    if (weatherMap.getLayer("provider-weather-layer")) weatherMap.removeLayer("provider-weather-layer");
    if (weatherMap.getSource("provider-weather-source")) weatherMap.removeSource("provider-weather-source");
}

function applyWeatherLayer(layer) {
    pageState.activeLayer = layer;
    document.querySelectorAll("[data-weather-layer]").forEach((button) => button.classList.toggle("active", button.dataset.weatherLayer === layer));
    removeWeatherLayer();
    const label = layer === "none" ? "Modelled flow only" : `${layer[0].toUpperCase()}${layer.slice(1)}`;
    setText("weather-map-layer-name", label);
    if (layer === "none" || !pageState.layerAvailable) return;
    weatherMap.addSource("provider-weather-source", {
        type: "raster",
        tiles: [`${window.location.origin}/api/weather/tiles/${layer}/{z}/{x}/{y}.png`],
        tileSize: 256,
        minzoom: 0,
        maxzoom: 12,
    });
    weatherMap.addLayer({
        id: "provider-weather-layer",
        type: "raster",
        source: "provider-weather-source",
        paint: { "raster-opacity": layer === "clouds" ? 0.58 : 0.72, "raster-fade-duration": 250 },
    }, weatherMap.getLayer("weather-outside-mask") ? "weather-outside-mask" : undefined);
}

function evidenceCard(item) {
    return `<article class="evidence-card"><header><small>${escapeHtml(item.title)}</small><strong>${escapeHtml(item.value)}</strong></header><p>${escapeHtml(item.interpretation)}</p><footer>Source: ${escapeHtml(item.source)}</footer></article>`;
}

function renderInterpretation(insight) {
    if (!insight) return;
    pageState.insight = insight;
    setText("weather-insight-mode", insight.provider_live ? "LIVE PROVIDER EVIDENCE" : String(insight.mode || "demo").toUpperCase());
    document.getElementById("weather-current-insights").innerHTML = (insight.current_interpretations || []).map(evidenceCard).join("") || '<div class="notice">No current interpretation is available.</div>';
    document.getElementById("weather-forecast-insights").innerHTML = (insight.forecast_interpretations || []).map(evidenceCard).join("") || '<div class="notice">No forecast interpretation is available.</div>';
    document.getElementById("weather-air-context").innerHTML = insight.air_quality_context ? evidenceCard(insight.air_quality_context) : '<div class="notice">No particulate context is available.</div>';
    setText("weather-visual-notice", insight.visualisation_notice || "Animation provenance is unavailable.");
    skyRenderer.update(pageState.frame?.weather || insight.current || {}, insight);
    mapFlow.update(pageState.frame || { weather: insight.current || {} }, insight);
}

function updateFrame(frame) {
    pageState.frame = frame;
    const weather = frame.weather || {};
    const direction = Number(weather.wind_direction_deg) || 0;
    const transport = (direction + 180) % 360;
    const liveWeather = String(frame.sources?.weather || "").toLowerCase().includes("openweather");
    setText("weather-temperature", Number(weather.temperature_c || 0).toFixed(1));
    setText("weather-condition", weather.condition || "Current conditions");
    setText("weather-source", frame.sources?.weather || "Unknown source");
    setText("weather-wind-speed", Number(weather.wind_speed_ms || 0).toFixed(1));
    setText("weather-wind-bearing", `m/s · from ${compassDirection(direction)} ${direction.toFixed(0)}°`);
    document.getElementById("weather-wind-needle").style.transform = `rotate(${direction}deg)`;
    setText("weather-humidity", `${Number(weather.humidity_pct || 0).toFixed(0)}%`);
    setText("weather-feels-like", `${Number(weather.feels_like_c ?? weather.temperature_c ?? 0).toFixed(1)}°C`);
    if (liveWeather && !weather.wind_gust_reported) {
        setText("weather-gust", "Not reported");
        setText("weather-gust-note", "Provider supplied sustained wind but no gust value");
    } else {
        setText("weather-gust", `${Number(weather.wind_gust_ms || 0).toFixed(1)} m/s`);
        setText("weather-gust-note", `Gust factor ${(Number(weather.wind_gust_ms || 0) / Math.max(Number(weather.wind_speed_ms || 0), 0.1)).toFixed(2)}×`);
    }
    setText("weather-pressure", `${Number(weather.pressure_hpa || 0).toFixed(0)} hPa`);
    setText("weather-visibility", liveWeather && !weather.visibility_reported ? "Not reported" : `${(Number(weather.visibility_m || 0) / 1000).toFixed(1)} km`);
    setText("weather-visibility-note", liveWeather && !weather.visibility_reported ? "Provider did not include visibility" : "Provider-reported visibility");
    setText("weather-cloud", `${Number(weather.cloud_cover_pct || 0).toFixed(0)}%`);
    setText("weather-rain", `${Number(weather.precipitation_mm_1h || 0).toFixed(2)} mm`);
    setText("weather-transport", `${compassDirection(transport)} ${transport.toFixed(0)}°`);
    setText("weather-age", ageLabel(weather.observed_at));
    if (weather.sunrise_at && weather.sunset_at) {
        const sunrise = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(weather.sunrise_at));
        const sunset = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Lagos", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(weather.sunset_at));
        setText("weather-daylight", `${sunrise}–${sunset}`);
        setText("weather-daylight-note", "Gombe local sunrise–sunset");
    } else {
        setText("weather-daylight", "Not reported");
        setText("weather-daylight-note", "Provider sunrise/sunset unavailable");
    }
    setText("weather-updated", `${formatDateTime(frame.generated_at)} UTC+1`);
    setText("weather-map-time", `Live frame ${formatDateTime(frame.generated_at)} UTC+1`);
    setText("stage-cloud", `${Number(weather.cloud_cover_pct || 0).toFixed(0)}%`);
    setText("stage-rain", `${Number(weather.precipitation_mm_1h || 0).toFixed(2)} mm/h`);
    setText("stage-flow", `${compassDirection(transport)} ${transport.toFixed(0)}°`);
    setText("weather-visual-mode", liveWeather ? "LIVE API VISUAL" : `${String(frame.mode || "demo").toUpperCase()} VISUAL`);
    setText("weather-visual-caption", `${weather.condition || "Current conditions"} · animation follows cloud, rain, wind and humidity fields`);
    skyRenderer.update(weather, pageState.insight);
    mapFlow.update(frame, pageState.insight);
}

async function loadForecast() {
    const container = document.getElementById("weather-forecast");
    try {
        const response = await fetch("/api/weather/forecast", { cache: "no-store" });
        if (!response.ok) throw new Error(`Forecast service returned ${response.status}`);
        const data = await response.json();
        pageState.forecast = data.forecast || [];
        const forecast = pageState.forecast.slice(0, 12);
        if (!forecast.length) {
            container.innerHTML = '<div class="notice">No official weather forecast is currently available. Check the OpenWeather API key and provider status.</div>';
            setText("forecast-source", "UNAVAILABLE");
        } else {
            setText("forecast-source", "OPENWEATHER");
            container.innerHTML = forecast.map((item) => `<article class="forecast-card" data-condition="${escapeHtml(String(item.condition_group || "forecast").toLowerCase())}"><time>${escapeHtml(formatDateTime(item.timestamp))}</time><strong>${Number(item.temperature_c).toFixed(1)}°C</strong><span>${escapeHtml(item.condition)}</span><span>Rain chance ${Number(item.precipitation_probability_pct || 0).toFixed(0)}% · ${Number(item.precipitation_mm_3h || 0).toFixed(2)} mm/3h</span><span>Cloud ${Number(item.cloud_cover_pct || 0).toFixed(0)}% · humidity ${Number(item.humidity_pct || 0).toFixed(0)}%</span><span>Wind ${Number(item.wind_speed_ms).toFixed(1)} m/s · ${escapeHtml(compassDirection(item.wind_direction_deg))}</span></article>`).join("");
            setText("forecast-note", `Provider forecast updated ${data.updated_at ? formatDateTime(data.updated_at) : "recently"}. Forecast values remain separate from observations.`);
        }
        renderInterpretation(data.interpretation);
    } catch (error) {
        container.innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
        setText("forecast-source", "ERROR");
    }
}

document.querySelectorAll("[data-weather-layer]").forEach((button) => button.addEventListener("click", () => applyWeatherLayer(button.dataset.weatherLayer)));
document.getElementById("weather-map-zoom-in").addEventListener("click", () => weatherMap.zoomIn());
document.getElementById("weather-map-zoom-out").addEventListener("click", () => weatherMap.zoomOut());
document.getElementById("weather-map-reset").addEventListener("click", () => pageState.mapBounds && weatherMap.fitBounds(pageState.mapBounds, { padding: window.innerWidth < 700 ? 26 : 50, maxZoom: 9, duration: 450 }));
document.getElementById("weather-map-fullscreen").addEventListener("click", async () => {
    const frame = document.getElementById("weather-map-frame");
    if (!document.fullscreenElement) await frame.requestFullscreen?.(); else await document.exitFullscreen?.();
    window.setTimeout(() => { weatherMap.resize(); mapFlow.resize(); }, 120);
});
weatherMap.on("load", () => initialiseWeatherMap().catch((error) => {
    setText("weather-layer-status", "MAP ERROR");
    setText("weather-map-note", error.message);
}));

connectLive(updateFrame, (status) => setText("portal-stream", status.toUpperCase()));
loadForecast();
window.setInterval(loadForecast, 30 * 60 * 1000);
