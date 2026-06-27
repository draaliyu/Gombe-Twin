import { connectLive, formatDateTime, initialisePortal, setText } from "./portal.js?v=10.1.0";

initialisePortal();

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
}

function clamp(value, minimum = 0, maximum = 100) {
    return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function featureName(feature) {
    const properties = feature?.properties || {};
    return String(properties.lga_name || properties.shapeName || properties.shape_name || properties.name || "Local Government Area");
}

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


function apparentTemperatureC(temperatureC, humidityPct, windSpeedMs) {
    const temperature = Number(temperatureC) || 0;
    const humidity = clamp(humidityPct, 0, 100);
    const wind = Math.max(0, Number(windSpeedMs) || 0);
    const vapourPressure = (humidity / 100) * 6.105 * Math.exp(17.27 * temperature / (237.7 + temperature));
    return temperature + 0.33 * vapourPressure - 0.70 * wind - 4.0;
}

function ambientBand(apparent) {
    if (apparent < 27) return { band: "lower", colour: "#55d9a0" };
    if (apparent < 32) return { band: "elevated", colour: "#f4d45e" };
    if (apparent < 38) return { band: "high", colour: "#ff963f" };
    return { band: "very high", colour: "#ef4f58" };
}

function heatColour(score) {
    const value = Number(score) || 0;
    if (value < 25) return "#47cfa0";
    if (value < 50) return "#f0d34f";
    if (value < 70) return "#ff963f";
    if (value < 85) return "#ef4f58";
    return "#8c4ab8";
}

function evidenceCard(item) {
    return `<article class="evidence-card"><header><small>${escapeHtml(item.title)}</small><strong>${escapeHtml(item.value)}</strong></header><p>${escapeHtml(item.interpretation)}</p><footer>Source: ${escapeHtml(item.source)}</footer></article>`;
}

class HeatSkyRenderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.context = canvas.getContext("2d", { alpha: true });
        this.host = canvas.parentElement;
        this.mobile = window.matchMedia("(max-width: 700px)").matches;
        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        this.targetInterval = 1000 / (this.reducedMotion ? 8 : this.mobile ? 22 : 34);
        this.width = 1;
        this.height = 1;
        this.last = 0;
        this.visible = true;
        this.state = { temperature: 31, humidity: 35, wind: 4, hotspotCount: 0, peakFrp: 0, apparent: 31, colour: "#ff963f" };
        this.ribbons = [];
        this.embers = [];
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.host);
        new IntersectionObserver((entries) => { this.visible = entries[0]?.isIntersecting ?? true; }, { rootMargin: "120px" }).observe(this.host);
        this.seed();
        this.resize();
        requestAnimationFrame((time) => this.animate(time));
    }

    seed() {
        this.ribbons = Array.from({ length: this.mobile ? 14 : 26 }, () => ({
            x: Math.random(), y: Math.random(), phase: Math.random() * Math.PI * 2,
            speed: 0.35 + Math.random() * 0.8, width: 35 + Math.random() * 90,
        }));
        this.embers = Array.from({ length: this.mobile ? 50 : 110 }, () => ({
            x: Math.random(), y: Math.random(), phase: Math.random() * Math.PI * 2,
            speed: 0.4 + Math.random() * 1.4, size: 0.7 + Math.random() * 2.3,
        }));
    }

    resize() {
        const rect = this.host.getBoundingClientRect();
        this.width = Math.max(1, rect.width);
        this.height = Math.max(1, rect.height);
        const dpr = Math.min(window.devicePixelRatio || 1, this.mobile ? 1 : 1.4);
        this.canvas.width = Math.round(this.width * dpr);
        this.canvas.height = Math.round(this.height * dpr);
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;
        this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    update(summary) {
        if (!summary) return;
        const ambient = summary.ambient || {};
        const thermal = summary.thermal || {};
        this.state = {
            temperature: Number(ambient.temperature_c) || 0,
            humidity: Number(ambient.humidity_pct) || 0,
            wind: Number(ambient.wind_speed_ms) || 0,
            hotspotCount: Number(thermal.hotspot_count) || 0,
            peakFrp: Number(thermal.peak_frp_mw) || 0,
            apparent: Number(ambient.apparent_temperature_c) || Number(ambient.temperature_c) || 0,
            colour: ambient.colour || "#ff963f",
        };
    }

    draw(time, dt) {
        const context = this.context;
        const state = this.state;
        const heatFactor = clamp((state.apparent - 22) / 20, 0.08, 1);
        const anomalyFactor = clamp(Math.log1p(state.peakFrp) / Math.log(101), 0, 1);
        const background = context.createLinearGradient(0, 0, this.width, this.height);
        background.addColorStop(0, "#2b1510");
        background.addColorStop(0.45, heatFactor > 0.55 ? "#7d321b" : "#3a2520");
        background.addColorStop(1, "#08151c");
        context.fillStyle = background;
        context.fillRect(0, 0, this.width, this.height);

        const orbX = this.width * 0.78;
        const orbY = this.height * 0.22;
        const orbRadius = Math.min(this.width, this.height) * (0.13 + heatFactor * 0.06);
        const orb = context.createRadialGradient(orbX, orbY, 0, orbX, orbY, orbRadius * 2.6);
        orb.addColorStop(0, `rgba(255,244,188,${0.78 + heatFactor * 0.18})`);
        orb.addColorStop(0.22, `rgba(255,142,54,${0.30 + heatFactor * 0.28})`);
        orb.addColorStop(0.55, `rgba(237,66,35,${0.10 + heatFactor * 0.20})`);
        orb.addColorStop(1, "rgba(237,66,35,0)");
        context.fillStyle = orb;
        context.beginPath();
        context.arc(orbX, orbY, orbRadius * 2.6, 0, Math.PI * 2);
        context.fill();

        context.save();
        context.globalCompositeOperation = "screen";
        for (const ribbon of this.ribbons) {
            ribbon.y -= (0.000025 + heatFactor * 0.00005) * ribbon.speed * dt;
            ribbon.x += Math.sin(time * 0.00065 + ribbon.phase) * 0.000015 * dt;
            if (ribbon.y < -0.2) { ribbon.y = 1.12; ribbon.x = Math.random(); }
            const x = ribbon.x * this.width;
            const y = ribbon.y * this.height;
            const curve = Math.sin(time * 0.0012 + ribbon.phase) * ribbon.width * 0.24;
            const gradient = context.createLinearGradient(x, y + ribbon.width, x + curve, y - ribbon.width);
            gradient.addColorStop(0, "rgba(255,120,41,0)");
            gradient.addColorStop(0.5, `rgba(255,169,66,${0.025 + heatFactor * 0.11})`);
            gradient.addColorStop(1, "rgba(255,246,198,0)");
            context.strokeStyle = gradient;
            context.lineWidth = this.mobile ? 1.2 : 1.8;
            context.beginPath();
            context.moveTo(x, y + ribbon.width);
            context.bezierCurveTo(x - ribbon.width * 0.25, y + ribbon.width * 0.35, x + curve, y - ribbon.width * 0.25, x, y - ribbon.width);
            context.stroke();
        }

        const activeEmbers = Math.round(this.embers.length * clamp(0.10 + anomalyFactor * 0.9, 0.08, 1));
        for (let index = 0; index < activeEmbers; index += 1) {
            const ember = this.embers[index];
            ember.y -= (0.00008 + anomalyFactor * 0.00016) * ember.speed * dt;
            ember.x += Math.sin(time * 0.0014 + ember.phase) * 0.000035 * dt;
            if (ember.y < -0.05) { ember.y = 1.05; ember.x = Math.random(); }
            const x = ember.x * this.width;
            const y = ember.y * this.height;
            const pulse = 0.45 + 0.55 * Math.sin(time * 0.004 + ember.phase) ** 2;
            context.fillStyle = `rgba(255,${Math.round(120 + pulse * 110)},60,${0.12 + pulse * 0.65 * anomalyFactor})`;
            context.shadowBlur = 8 + 18 * anomalyFactor;
            context.shadowColor = "#ff8b35";
            context.beginPath();
            context.arc(x, y, ember.size * (0.7 + pulse), 0, Math.PI * 2);
            context.fill();
        }
        context.restore();

        const shimmer = 0.02 + heatFactor * 0.05;
        context.fillStyle = `rgba(255,145,70,${shimmer})`;
        for (let band = 0; band < 5; band += 1) {
            const y = this.height * (0.55 + band * 0.08) + Math.sin(time * 0.0015 + band) * 8;
            context.fillRect(0, y, this.width, 1 + heatFactor * 2);
        }
    }

    animate(time) {
        const elapsed = time - this.last;
        if (this.visible && !document.hidden && elapsed >= this.targetInterval) {
            this.draw(time, Math.min(elapsed || this.targetInterval, 80));
            this.last = time;
        }
        requestAnimationFrame((next) => this.animate(next));
    }
}

class HeatAuraRenderer {
    constructor(canvas, map) {
        this.canvas = canvas;
        this.context = canvas.getContext("2d", { alpha: true });
        this.map = map;
        this.host = canvas.parentElement;
        this.mobile = window.matchMedia("(max-width: 700px)").matches;
        this.targetInterval = 1000 / (this.mobile ? 24 : 36);
        this.last = 0;
        this.hotspots = [];
        this.mode = "ambient";
        this.ambient = null;
        this.visible = true;
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(this.host);
        new IntersectionObserver((entries) => { this.visible = entries[0]?.isIntersecting ?? true; }, { rootMargin: "100px" }).observe(this.host);
        this.resize();
        requestAnimationFrame((time) => this.animate(time));
    }

    resize() {
        const rect = this.host.getBoundingClientRect();
        this.width = Math.max(1, rect.width);
        this.height = Math.max(1, rect.height);
        const dpr = Math.min(window.devicePixelRatio || 1, this.mobile ? 1 : 1.3);
        this.canvas.width = Math.round(this.width * dpr);
        this.canvas.height = Math.round(this.height * dpr);
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;
        this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    update(summary, mode = this.mode) {
        this.mode = mode;
        this.hotspots = summary?.thermal?.detections || [];
        this.ambient = summary?.ambient || null;
    }

    draw(time) {
        const context = this.context;
        context.clearRect(0, 0, this.width, this.height);
        if (!this.map.loaded()) return;
        const apparent = Number(this.ambient?.apparent_temperature_c) || 28;
        const ambientFactor = clamp((apparent - 20) / 20, 0, 1);

        if (this.mode === "ambient" || this.mode === "combined") {
            const waveCount = this.mobile ? 4 : 7;
            for (let index = 0; index < waveCount; index += 1) {
                const y = this.height * (0.22 + index * 0.10) + Math.sin(time * 0.0012 + index * 1.7) * (7 + ambientFactor * 13);
                const gradient = context.createLinearGradient(0, y, this.width, y);
                gradient.addColorStop(0, "rgba(255,109,35,0)");
                gradient.addColorStop(0.35, `rgba(255,145,48,${0.02 + ambientFactor * 0.08})`);
                gradient.addColorStop(0.7, `rgba(255,214,104,${0.015 + ambientFactor * 0.06})`);
                gradient.addColorStop(1, "rgba(255,109,35,0)");
                context.strokeStyle = gradient;
                context.lineWidth = 1 + ambientFactor * 2;
                context.beginPath();
                context.moveTo(0, y);
                for (let x = 0; x <= this.width; x += 24) {
                    context.lineTo(x, y + Math.sin(x * 0.018 + time * 0.0014 + index) * (3 + ambientFactor * 8));
                }
                context.stroke();
            }
        }

        if (this.mode === "thermal" || this.mode === "combined") {
            context.save();
            context.globalCompositeOperation = "screen";
            for (const hotspot of this.hotspots) {
                const point = this.map.project([Number(hotspot.longitude), Number(hotspot.latitude)]);
                if (point.x < -100 || point.y < -100 || point.x > this.width + 100 || point.y > this.height + 100) continue;
                const frp = Math.max(0, Number(hotspot.frp) || 0);
                const strength = clamp(Math.log1p(frp) / Math.log(101), 0.15, 1);
                const pulse = (time * (0.00042 + strength * 0.00018) + Number(String(hotspot.id).replace(/\D/g, "").slice(-4) || 0) * 0.001) % 1;
                const radius = 10 + pulse * (38 + 55 * strength);
                const alpha = (1 - pulse) * (0.18 + strength * 0.42);
                context.strokeStyle = `rgba(255,93,37,${alpha})`;
                context.lineWidth = 1.3 + strength * 2.4;
                context.shadowBlur = 12 + strength * 24;
                context.shadowColor = "#ff5d25";
                context.beginPath();
                context.arc(point.x, point.y, radius, 0, Math.PI * 2);
                context.stroke();

                const glow = context.createRadialGradient(point.x, point.y, 0, point.x, point.y, 18 + 32 * strength);
                glow.addColorStop(0, `rgba(255,245,196,${0.6 + strength * 0.35})`);
                glow.addColorStop(0.18, `rgba(255,114,37,${0.38 + strength * 0.30})`);
                glow.addColorStop(1, "rgba(228,40,26,0)");
                context.fillStyle = glow;
                context.beginPath();
                context.arc(point.x, point.y, 18 + 32 * strength, 0, Math.PI * 2);
                context.fill();
            }
            context.restore();
        }
    }

    animate(time) {
        const elapsed = time - this.last;
        if (this.visible && !document.hidden && elapsed >= this.targetInterval) {
            this.draw(time);
            this.last = time;
        }
        requestAnimationFrame((next) => this.animate(next));
    }
}

const pageState = {
    frame: null,
    summary: null,
    heatRegions: null,
    selected: "",
    mode: "ambient",
    bounds: null,
};

const heatMap = new maplibregl.Map({
    container: "heat-map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [11.24, 10.43],
    zoom: 7.5,
    pitch: 0,
    bearing: 0,
    cooperativeGestures: true,
    renderWorldCopies: false,
    attributionControl: false,
    fadeDuration: 0,
});

const skyRenderer = new HeatSkyRenderer(document.getElementById("heat-sky-canvas"));
const auraRenderer = new HeatAuraRenderer(document.getElementById("heat-aura-canvas"), heatMap);

function fitBoundary(boundary, duration = 0) {
    const coordinates = (boundary.features || []).flatMap((feature) => allCoordinates(feature.geometry));
    if (!coordinates.length) return;
    const bounds = coordinates.reduce((box, coordinate) => box.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
    pageState.bounds = bounds;
    heatMap.fitBounds(bounds, { padding: window.innerWidth < 700 ? 28 : 54, maxZoom: 9, duration });
}

function fillColourExpression(mode) {
    if (mode === "thermal") return ["coalesce", ["get", "thermal_colour"], "#54b7cc"];
    if (mode === "combined") return ["coalesce", ["get", "attention_colour"], "#47cfa0"];
    return ["coalesce", ["get", "ambient_colour"], "#f0d34f"];
}

function fillOpacityExpression(mode) {
    if (mode === "thermal") return ["interpolate", ["linear"], ["coalesce", ["get", "thermal_weighted_frp"], 0], 0, 0.09, 5, 0.20, 20, 0.34, 60, 0.50];
    if (mode === "combined") return ["interpolate", ["linear"], ["coalesce", ["get", "attention_score"], 0], 0, 0.10, 50, 0.28, 100, 0.48];
    return ["interpolate", ["linear"], ["coalesce", ["get", "ambient_apparent_c"], 20], 20, 0.10, 30, 0.25, 40, 0.42];
}

function updateMapMode(mode) {
    pageState.mode = mode;
    document.querySelectorAll("[data-heat-mode]").forEach((button) => button.classList.toggle("active", button.dataset.heatMode === mode));
    if (heatMap.getLayer("heat-region-fill")) {
        heatMap.setPaintProperty("heat-region-fill", "fill-color", fillColourExpression(mode));
        heatMap.setPaintProperty("heat-region-fill", "fill-opacity", fillOpacityExpression(mode));
    }
    const labels = {
        ambient: ["Ambient apparent-temperature screen", "Ambient heat"],
        thermal: ["Distance-weighted FIRMS thermal anomalies", "FIRMS anomalies"],
        combined: ["Combined visual attention score", "Combined attention"],
    };
    setText("heat-legend-title", labels[mode][0]);
    setText("heat-map-mode-label", labels[mode][1]);
    document.getElementById("heat-gradient-bar").dataset.mode = mode;
    auraRenderer.update(pageState.summary, mode);
}

function updateHotspotSource(summary) {
    if (!heatMap.getSource("heat-hotspots")) return;
    const features = (summary?.thermal?.detections || []).map((hotspot) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [Number(hotspot.longitude), Number(hotspot.latitude)] },
        properties: {
            id: hotspot.id,
            frp: Number(hotspot.frp) || 0,
            brightness: Number(hotspot.brightness) || 0,
            confidence: hotspot.confidence || "unknown",
            acquired_at: hotspot.acquired_at || "",
        },
    }));
    heatMap.getSource("heat-hotspots").setData({ type: "FeatureCollection", features });
}

async function initialiseHeatMap() {
    const [boundaryResponse, regionsResponse] = await Promise.all([
        fetch("/api/boundary", { cache: "no-store" }),
        fetch("/api/heat/regions", { cache: "no-store" }),
    ]);
    if (!boundaryResponse.ok || !regionsResponse.ok) throw new Error("Heat geography service is unavailable");
    const boundary = await boundaryResponse.json();
    const regions = await regionsResponse.json();
    pageState.heatRegions = regions;

    heatMap.addSource("heat-state", { type: "geojson", data: boundary });
    heatMap.addLayer({ id: "heat-state-fill", type: "fill", source: "heat-state", paint: { "fill-color": "#1b120f", "fill-opacity": 0.20 } });
    heatMap.addSource("heat-regions", { type: "geojson", data: regions, generateId: true });
    heatMap.addLayer({
        id: "heat-region-fill",
        type: "fill",
        source: "heat-regions",
        filter: ["==", ["geometry-type"], "Polygon"],
        paint: { "fill-color": fillColourExpression("ambient"), "fill-opacity": fillOpacityExpression("ambient") },
    });
    heatMap.addLayer({ id: "heat-region-line", type: "line", source: "heat-regions", paint: { "line-color": "rgba(255,220,183,.65)", "line-width": 1.1 } });
    heatMap.addLayer({
        id: "heat-region-points",
        type: "circle",
        source: "heat-regions",
        filter: ["==", ["geometry-type"], "Point"],
        paint: { "circle-radius": 8, "circle-color": fillColourExpression("ambient"), "circle-stroke-color": "#fff", "circle-stroke-width": 1.4 },
    });
    heatMap.addSource("heat-hotspots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
    heatMap.addLayer({
        id: "heat-hotspot-glow",
        type: "circle",
        source: "heat-hotspots",
        paint: {
            "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "frp"], 0], 0, 8, 20, 13, 80, 20],
            "circle-color": "rgba(255,72,24,.34)",
            "circle-blur": 0.75,
        },
    });
    heatMap.addLayer({
        id: "heat-hotspot-core",
        type: "circle",
        source: "heat-hotspots",
        paint: {
            "circle-radius": ["interpolate", ["linear"], ["coalesce", ["get", "frp"], 0], 0, 3, 20, 5, 80, 8],
            "circle-color": "#ff7b2e",
            "circle-stroke-color": "#fff2c9",
            "circle-stroke-width": 1,
        },
    });
    heatMap.addSource("heat-mask", { type: "geojson", data: outsideMask(boundary) });
    heatMap.addLayer({ id: "heat-mask", type: "fill", source: "heat-mask", paint: { "fill-color": "#02080d", "fill-opacity": 0.91 } });
    heatMap.addLayer({ id: "heat-state-line", type: "line", source: "heat-state", paint: { "line-color": "#f7d9ad", "line-width": 2.2, "line-opacity": 0.95 } });

    for (const layer of ["heat-region-fill", "heat-region-points"]) {
        heatMap.on("mouseenter", layer, () => { heatMap.getCanvas().style.cursor = "pointer"; });
        heatMap.on("mouseleave", layer, () => { heatMap.getCanvas().style.cursor = ""; });
        heatMap.on("click", layer, (event) => {
            const name = featureName(event.features?.[0]);
            if (name) selectRegion(name);
        });
    }
    heatMap.on("click", "heat-hotspot-core", (event) => {
        const properties = event.features?.[0]?.properties || {};
        new maplibregl.Popup({ closeButton: true, maxWidth: "280px" })
            .setLngLat(event.lngLat)
            .setHTML(`<strong>FIRMS thermal detection</strong><p>FRP ${Number(properties.frp || 0).toFixed(1)} MW · confidence ${escapeHtml(properties.confidence || "unknown")}</p><small>${escapeHtml(properties.acquired_at || "Acquisition time unavailable")}</small>`)
            .addTo(heatMap);
    });
    fitBoundary(boundary);
    updateMapMode("ambient");
    setText("heat-map-status", `${regions.features?.length || 0} GOMBE LGAs`);
    populateRegionSelect(regions.features || []);
    if (pageState.summary) updateHotspotSource(pageState.summary);
}

function populateRegionSelect(features) {
    const select = document.getElementById("heat-region-select");
    const existing = new Set(Array.from(select.options).map((option) => option.value));
    const names = features.map(featureName).filter(Boolean).sort((left, right) => left.localeCompare(right));
    for (const name of names) {
        if (existing.has(name)) continue;
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        select.append(option);
    }
}

function renderSummary(summary) {
    pageState.summary = summary;
    skyRenderer.update(summary);
    auraRenderer.update(summary, pageState.mode);
    updateHotspotSource(summary);
    const ambient = summary.ambient || {};
    const thermal = summary.thermal || {};
    setText("heat-temperature", Number(ambient.temperature_c || 0).toFixed(1));
    setText("heat-apparent", `${Number(ambient.apparent_temperature_c || 0).toFixed(1)}°C`);
    setText("heat-band", String(ambient.band || "unknown").toUpperCase());
    setText("heat-humidity", `${Number(ambient.humidity_pct || 0).toFixed(0)}%`);
    setText("heat-wind", `${Number(ambient.wind_speed_ms || 0).toFixed(1)} m/s`);
    setText("heat-hotspots", String(thermal.hotspot_count ?? 0));
    setText("heat-peak-frp", `${Number(thermal.peak_frp_mw || 0).toFixed(1)} MW`);
    setText("heat-updated", `${formatDateTime(summary.generated_at)} UTC+1`);
    setText("heat-map-time", `Live frame ${formatDateTime(summary.generated_at)} UTC+1`);
    setText("heat-data-mode", `${String(summary.mode || "demo").toUpperCase()} EVIDENCE`);
    setText("heat-stage-source", `${summary.weather_source || "weather source unavailable"} · ${summary.firms_source || "thermal source unavailable"}`);
    setText("heat-evidence-source", `${summary.weather_source || "WEATHER"} + ${summary.firms_source || "FIRMS"}`.toUpperCase());
    document.getElementById("heat-apparent-orb").style.setProperty("--heat-colour", ambient.colour || "#ff963f");
    if (heatMap.getSource("heat-regions") && summary.regions) heatMap.getSource("heat-regions").setData(summary.regions);
}

function renderRegion(insight) {
    const ambient = insight.ambient || {};
    const thermal = insight.thermal_anomaly || {};
    const attention = insight.attention || {};
    setText("heat-region-name", insight.region || "Selected LGA");
    setText("heat-region-score", Number(attention.score || 0).toFixed(0));
    setText("heat-region-band", `${String(thermal.band || ambient.band || "unknown").toUpperCase()}`);
    setText("heat-region-meaning", thermal.nearby_count ? `${thermal.nearby_count} nearby satellite thermal detection${thermal.nearby_count === 1 ? "" : "s"}` : "No nearby FIRMS detection in the current feed");
    setText("heat-region-apparent", `${Number(ambient.apparent_temperature_c || 0).toFixed(1)} °C`);
    setText("heat-region-count", String(thermal.nearby_count ?? 0));
    setText("heat-region-frp", `${Number(thermal.total_frp_mw || 0).toFixed(1)} MW`);
    setText("heat-region-nearest", thermal.nearest_km == null ? "None ≤75 km" : `${Number(thermal.nearest_km).toFixed(1)} km`);
    setText("heat-possible-meaning", insight.possible_meaning || "No interpretation is available.");
    document.getElementById("heat-region-summary").style.setProperty("--heat-region-colour", attention.colour || heatColour(attention.score));
    document.getElementById("heat-evidence").innerHTML = (insight.interpretations || []).map(evidenceCard).join("") || '<div class="notice">No source-labelled evidence is available.</div>';
    document.getElementById("heat-caveats").innerHTML = (insight.caveats || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}

async function selectRegion(name) {
    if (!name) return;
    pageState.selected = name;
    document.getElementById("heat-region-select").value = name;
    setText("heat-region-name", name);
    setText("heat-region-meaning", "Loading current heat evidence…");
    document.getElementById("heat-evidence").innerHTML = '<div class="evidence-card loading-shimmer"><p>Loading source-labelled heat evidence…</p></div>';
    try {
        const response = await fetch(`/api/heat/region?name=${encodeURIComponent(name)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Heat evidence service returned ${response.status}`);
        const insight = await response.json();
        renderRegion(insight);
    } catch (error) {
        document.getElementById("heat-evidence").innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
    }
}

async function loadHeatSummary() {
    try {
        const response = await fetch("/api/heat/summary", { cache: "no-store" });
        if (!response.ok) throw new Error(`Heat summary service returned ${response.status}`);
        const summary = await response.json();
        renderSummary(summary);
        if (pageState.selected) selectRegion(pageState.selected);
    } catch (error) {
        setText("heat-map-status", "HEAT SERVICE ERROR");
        setText("heat-map-note", error.message);
    }
}

function updateLiveFrame(frame) {
    pageState.frame = frame;
    setText("heat-condition", frame.weather?.condition || "Current weather");
    if (pageState.summary) {
        pageState.summary.generated_at = frame.generated_at;
        pageState.summary.mode = frame.mode;
        pageState.summary.weather_source = frame.sources?.weather;
        pageState.summary.firms_source = frame.sources?.firms;
        pageState.summary.ambient.temperature_c = frame.weather?.temperature_c;
        pageState.summary.ambient.humidity_pct = frame.weather?.humidity_pct;
        pageState.summary.ambient.wind_speed_ms = frame.weather?.wind_speed_ms;
        pageState.summary.ambient.rain_mm_1h = frame.weather?.precipitation_mm_1h;
        pageState.summary.ambient.provider_feels_like_c = frame.weather?.feels_like_c ?? frame.weather?.temperature_c;
        const apparent = apparentTemperatureC(frame.weather?.temperature_c, frame.weather?.humidity_pct, frame.weather?.wind_speed_ms);
        const band = ambientBand(apparent);
        pageState.summary.ambient.apparent_temperature_c = apparent;
        pageState.summary.ambient.band = band.band;
        pageState.summary.ambient.colour = band.colour;
        pageState.summary.thermal.hotspot_count = frame.hotspots?.length || 0;
        pageState.summary.thermal.detections = frame.hotspots || [];
        pageState.summary.thermal.total_frp_mw = (frame.hotspots || []).reduce((sum, hotspot) => sum + Number(hotspot.frp || 0), 0);
        pageState.summary.thermal.peak_frp_mw = Math.max(0, ...(frame.hotspots || []).map((hotspot) => Number(hotspot.frp || 0)));
        renderSummary(pageState.summary);
    }
}

document.querySelectorAll("[data-heat-mode]").forEach((button) => button.addEventListener("click", () => updateMapMode(button.dataset.heatMode)));
document.getElementById("heat-region-select").addEventListener("change", (event) => selectRegion(event.target.value));
document.getElementById("heat-map-zoom-in").addEventListener("click", () => heatMap.zoomIn());
document.getElementById("heat-map-zoom-out").addEventListener("click", () => heatMap.zoomOut());
document.getElementById("heat-map-reset").addEventListener("click", () => pageState.bounds && heatMap.fitBounds(pageState.bounds, { padding: window.innerWidth < 700 ? 28 : 54, maxZoom: 9, duration: 450 }));
document.getElementById("heat-map-fullscreen").addEventListener("click", async () => {
    const frame = document.getElementById("heat-map-frame");
    if (!document.fullscreenElement) await frame.requestFullscreen?.(); else await document.exitFullscreen?.();
    window.setTimeout(() => { heatMap.resize(); auraRenderer.resize(); }, 130);
});

heatMap.on("load", () => initialiseHeatMap().catch((error) => {
    setText("heat-map-status", "MAP ERROR");
    setText("heat-map-note", error.message);
}));

connectLive(updateLiveFrame, (status) => setText("portal-stream", status.toUpperCase()));
loadHeatSummary();
window.setInterval(loadHeatSummary, 30_000);
