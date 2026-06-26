import { DustParticleField } from "./dust.js?v=8.0.0";
import { WindFlowField } from "./wind.js?v=8.0.0";
import { HeatHazeField } from "./heat.js?v=8.0.0";
import { LiveCharts } from "./charts.js?v=8.0.0";

const GOMBE_VIEW = { center: [11.24, 10.43], zoom: 7.72, pitch: 0, bearing: 0 };
const FALLBACK_GOMBE_BOUNDS = { west: 10.30, south: 9.48, east: 12.24, north: 11.49 };
const WORLD_RING = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
const GOMBE_PLACES = [
    { name: "Gombe", coordinates: [11.1673, 10.2897], rank: 1, type: "capital" },
    { name: "Kumo", coordinates: [11.2108, 10.0487], rank: 1, type: "town" },
    { name: "Billiri", coordinates: [11.2261, 9.8650], rank: 1, type: "town" },
    { name: "Kaltungo", coordinates: [11.3089, 9.8142], rank: 1, type: "town" },
    { name: "Dukku", coordinates: [10.7722, 10.8238], rank: 1, type: "town" },
    { name: "Bajoga", coordinates: [11.4322, 10.8534], rank: 1, type: "town" },
    { name: "Nafada", coordinates: [11.3328, 11.0957], rank: 1, type: "town" },
    { name: "Deba", coordinates: [11.3874, 10.2097], rank: 1, type: "town" },
    { name: "Akko", coordinates: [11.0038, 10.2879], rank: 2, type: "town" },
    { name: "Kwami", coordinates: [11.0155, 10.4948], rank: 2, type: "town" },
    { name: "Dadin Kowa", coordinates: [11.4962, 10.3198], rank: 2, type: "town" },
    { name: "Talasse", coordinates: [11.6797, 9.9688], rank: 2, type: "town" },
    { name: "Bambam", coordinates: [11.2588, 9.6977], rank: 2, type: "town" },
    { name: "Shongom", coordinates: [11.1576, 9.6323], rank: 2, type: "town" },
    { name: "Tula", coordinates: [11.3008, 9.6951], rank: 2, type: "village" },
    { name: "Pindiga", coordinates: [10.9304, 10.2724], rank: 2, type: "town" },
    { name: "Kashere", coordinates: [10.8657, 9.9958], rank: 3, type: "village" },
    { name: "Cham", coordinates: [11.7312, 9.7068], rank: 3, type: "village" },
    { name: "Filiya", coordinates: [11.2292, 9.5900], rank: 3, type: "village" },
    { name: "Mallam Sidi", coordinates: [11.1942, 10.9694], rank: 3, type: "village" },
    { name: "Bojude", coordinates: [11.0866, 10.4752], rank: 3, type: "village" },
    { name: "Kuri", coordinates: [11.1436, 10.0908], rank: 3, type: "village" },
];
const RADARS = [
    { name: "GOMBE CENTRAL", coordinates: [11.1673, 10.2897] },
    { name: "KALTUNGO SOUTH", coordinates: [11.3089, 9.8142] },
    { name: "DUKKU NORTH", coordinates: [10.7722, 10.8238] },
];

const state = {
    frame: null,
    previousFrame: null,
    socket: null,
    reconnectAttempt: 0,
    particlesEnabled: true,
    windEnabled: true,
    heatEnabled: true,
    radarEnabled: true,
    autoRotate: false,
    visualBoost: true,
    radarMarkers: [],
    placeLabels: [],
    boundaryPolygons: [],
    boundaryBounds: { ...FALLBACK_GOMBE_BOUNDS },
    boundaryReady: false,
    mapReady: false,
    lgaFeatures: [],
    selectedLgaName: null,
    platformMode: "desktop",
    lastLgaMapUpdate: 0,
};

const elementIds = [
    "socket-dot", "stream-status", "frame-sequence", "packet-age", "live-clock", "mode-badge",
    "pm25-value", "pm10-value", "pm25-delta", "pm10-delta", "aqi-value", "aqi-category", "aqi-guidance", "aqi-banner",
    "temperature", "condition", "weather-symbol", "wind-speed", "wind-bearing", "wind-arrow", "gust-speed", "humidity",
    "humidity-state", "pressure", "dew-point", "cloud-cover", "visibility", "rainfall", "beaufort-label", "observed-age",
    "weather-source", "air-source", "firms-source", "risk-level", "dust-index", "health-risk", "aviation-risk",
    "dust-gauge", "health-gauge", "aviation-gauge", "alert-card", "alert-label", "alert-message", "sensor-count",
    "dispersion-score", "gust-factor", "particle-count", "wind-line-count", "transport-bearing", "wind-card-state",
    "wind-chart-value", "hotspot-count", "thermal-fill", "thermal-intensity", "thermal-intensity-fill",
    "peak-frp", "peak-frp-fill", "surface-heat", "surface-heat-fill", "hotspot-updated",
    "thermal-state", "thermal-core", "thermal-stress", "thermal-ambient", "apparent-temperature",
    "radiance-index", "spark-count", "ambient-heat-fill", "ambient-heat-value", "ambient-heat-label",
    "radiance-fill", "radiance-value", "frp-heat-fill", "frp-heat-value", "thermal-hotspot-count",
    "exposure-fill", "exposure-value", "connected-clients", "map-subtitle", "toast",
    "motion-status", "animation-fps", "visible-sparks", "visible-wind", "active-flashes", "sparkle-severity",
    "map-thermal-state", "map-ambient-fill", "map-ambient-value", "map-radiance-fill", "map-radiance-value",
    "map-frp-fill", "map-frp-value", "map-exposure-fill", "map-exposure-value",
    "last-updated", "map-last-updated", "lga-info-card", "lga-name", "lga-aqi", "lga-aqi-orb", "lga-aqi-category",
    "lga-pm25", "lga-pm10", "lga-temperature", "lga-humidity", "lga-wind",
    "lga-health-recommendation", "lga-updated",
];
const elements = Object.fromEntries(elementIds.map((id) => [id, document.getElementById(id)]));


function updatePlatformMode() {
    const width = window.innerWidth || document.documentElement.clientWidth || 1200;
    const mode = width <= 640 ? "mobile" : width <= 980 ? "tablet" : "desktop";
    const previousMode = state.platformMode;
    state.platformMode = mode;
    document.body.classList.toggle("platform-mobile", mode === "mobile");
    document.body.classList.toggle("platform-tablet", mode === "tablet");
    document.body.classList.toggle("platform-desktop", mode === "desktop");
    document.documentElement.style.setProperty("--client-width", `${width}px`);
    if (previousMode !== mode) applyPerformanceProfile();
    const legend = document.getElementById("map-legend");
    const legendToggle = document.getElementById("legend-toggle");
    if (legend && legendToggle && !legend.dataset.userToggled) {
        const expanded = mode === "desktop";
        legend.classList.toggle("expanded", expanded);
        legendToggle.setAttribute("aria-expanded", String(expanded));
        const icon = legendToggle.querySelector("b");
        if (icon) icon.textContent = expanded ? "−" : "+";
    }
    if (state.mapReady) {
        window.setTimeout(() => {
            map.resize();
            updateSpatialOverlays();
            focusGombeBoundary(420);
        }, 120);
    }
}

const map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    ...GOMBE_VIEW,
    maxPitch: 75,
    antialias: window.innerWidth > 980,
    attributionControl: false,
    cooperativeGestures: false,
    renderWorldCopies: false,
    fadeDuration: 0,
});

map.addControl(new maplibregl.NavigationControl({ visualizePitch: true, showCompass: false }), "bottom-left");

const windField = new WindFlowField(map, document.getElementById("wind-canvas"));
const heatField = new HeatHazeField(map, document.getElementById("heat-canvas"));
const dustField = new DustParticleField(map, document.getElementById("dust-canvas"));
const charts = new LiveCharts(document.getElementById("particle-chart"), document.getElementById("wind-chart"));
const appShell = document.querySelector(".app-shell");

function applyPerformanceProfile() {
    const mode = state.platformMode || "desktop";
    dustField?.setQuality?.(mode);
    windField?.setQuality?.(mode);
    heatField?.setQuality?.(mode);
}

updatePlatformMode();
let platformResizeTimer = 0;
function schedulePlatformUpdate(delay = 120) {
    window.clearTimeout(platformResizeTimer);
    platformResizeTimer = window.setTimeout(updatePlatformMode, delay);
}
window.addEventListener("resize", () => schedulePlatformUpdate(120), { passive: true });
window.addEventListener("orientationchange", () => schedulePlatformUpdate(280), { passive: true });
appShell.classList.add("visual-boost");
dustField.setBoost(true);
windField.setBoost(true);
heatField.setBoost(true);

map.on("load", async () => {
    addTerrain();
    await addBoundary();
    await addLgaLayers();
    addDynamicLayers();
    createRadarMarkers();
    state.mapReady = true;
    if (state.frame) updateMap(state.frame);
    showToast("Live geospatial twin initialised");
});

const mapResizeObserver = new ResizeObserver(() => {
    map.resize();
    updateSpatialOverlays();
    window.clearTimeout(mapResizeObserver.refitTimer);
    mapResizeObserver.refitTimer = window.setTimeout(() => {
        if (state.boundaryReady && !map.isMoving()) focusGombeBoundary(0);
    }, 160);
});
mapResizeObserver.observe(map.getContainer());

function addTerrain() {
    if (state.platformMode !== "desktop") return;
    try {
        map.addSource("terrain-dem", {
            type: "raster-dem",
            url: "https://demotiles.maplibre.org/terrain-tiles/tiles.json",
            tileSize: 256,
        });
        map.setTerrain({ source: "terrain-dem", exaggeration: 1.35 });
    } catch (error) {
        console.warn("Terrain layer unavailable", error);
    }
}

function hideBasemapLabels() {
    const layers = map.getStyle()?.layers || [];
    for (const layer of layers) {
        if (layer.type === "symbol" && map.getLayer(layer.id)) {
            map.setLayoutProperty(layer.id, "visibility", "none");
        }
    }
}

function normaliseBoundaryPolygons(boundary) {
    const polygons = [];
    const features = boundary?.type === "FeatureCollection"
        ? boundary.features || []
        : boundary?.type === "Feature"
            ? [boundary]
            : boundary?.type
                ? [{ type: "Feature", geometry: boundary, properties: {} }]
                : [];
    for (const feature of features) {
        const geometry = feature?.geometry;
        if (!geometry) continue;
        if (geometry.type === "Polygon") polygons.push(geometry.coordinates);
        if (geometry.type === "MultiPolygon") polygons.push(...geometry.coordinates);
    }
    return polygons;
}

function calculateBoundaryBounds(polygons) {
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const polygon of polygons) {
        for (const ring of polygon) {
            for (const [longitude, latitude] of ring) {
                west = Math.min(west, longitude);
                south = Math.min(south, latitude);
                east = Math.max(east, longitude);
                north = Math.max(north, latitude);
            }
        }
    }
    return Number.isFinite(west) ? { west, south, east, north } : { ...FALLBACK_GOMBE_BOUNDS };
}

function pointInRing(longitude, latitude, ring) {
    let inside = false;
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
        const [x1, y1] = ring[index];
        const [x2, y2] = ring[previous];
        const intersects = ((y1 > latitude) !== (y2 > latitude))
            && (longitude < ((x2 - x1) * (latitude - y1)) / ((y2 - y1) || Number.EPSILON) + x1);
        if (intersects) inside = !inside;
    }
    return inside;
}

function pointInBoundary(longitude, latitude) {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;
    if (!state.boundaryPolygons.length) {
        const bounds = state.boundaryBounds;
        return longitude >= bounds.west && longitude <= bounds.east
            && latitude >= bounds.south && latitude <= bounds.north;
    }
    return state.boundaryPolygons.some((polygon) => {
        if (!polygon?.length || !pointInRing(longitude, latitude, polygon[0])) return false;
        for (let index = 1; index < polygon.length; index += 1) {
            if (pointInRing(longitude, latitude, polygon[index])) return false;
        }
        return true;
    });
}

function createOutsideMaskGeoJson(polygons) {
    const holes = polygons
        .map((polygon) => polygon?.[0])
        .filter((ring) => Array.isArray(ring) && ring.length >= 4);
    return {
        type: "FeatureCollection",
        features: [{
            type: "Feature",
            properties: { role: "outside-gombe-mask" },
            geometry: { type: "Polygon", coordinates: [WORLD_RING, ...holes] },
        }],
    };
}

function responsiveMapPadding() {
    const width = map.getContainer().clientWidth;
    const height = map.getContainer().clientHeight;
    const top = width >= 720 ? 76 : 62;
    const horizontal = width >= 900 ? 54 : width >= 620 ? 38 : 24;
    const bottom = height >= 470 ? 34 : 24;
    return { top, bottom, left: horizontal, right: horizontal };
}

function focusGombeBoundary(duration = 0) {
    const bounds = state.boundaryBounds;
    const mapBounds = [[bounds.west, bounds.south], [bounds.east, bounds.north]];
    const marginLongitude = Math.max(0.025, (bounds.east - bounds.west) * 0.025);
    const marginLatitude = Math.max(0.025, (bounds.north - bounds.south) * 0.025);
    map.setMaxBounds([
        [bounds.west - marginLongitude, bounds.south - marginLatitude],
        [bounds.east + marginLongitude, bounds.north + marginLatitude],
    ]);
    map.setPitch(GOMBE_VIEW.pitch);
    map.setBearing(GOMBE_VIEW.bearing);
    map.fitBounds(mapBounds, {
        padding: responsiveMapPadding(),
        duration,
        maxZoom: 8.95,
        essential: true,
    });
}

function buildScreenMaskPath() {
    const overlay = document.getElementById("state-mask-overlay");
    const maskPath = document.getElementById("state-mask-path");
    const outlinePath = document.getElementById("state-outline-path");
    if (!overlay || !maskPath || !outlinePath || !state.boundaryPolygons.length) return;
    const container = map.getContainer();
    const width = container.clientWidth;
    const height = container.clientHeight;
    overlay.setAttribute("viewBox", `0 0 ${width} ${height}`);
    let maskData = `M0 0H${width}V${height}H0Z`;
    let outlineData = "";
    for (const polygon of state.boundaryPolygons) {
        const exterior = polygon?.[0] || [];
        if (exterior.length < 3) continue;
        exterior.forEach((coordinate, index) => {
            const point = map.project(coordinate);
            const command = index === 0 ? "M" : "L";
            maskData += `${command}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
            outlineData += `${command}${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
        });
        maskData += "Z";
        outlineData += "Z";
    }
    maskPath.setAttribute("d", maskData);
    outlinePath.setAttribute("d", outlineData);
}

function createPlaceLabels() {
    const layer = document.getElementById("place-label-layer");
    if (!layer) return;
    layer.replaceChildren();
    state.placeLabels = GOMBE_PLACES
        .filter((place) => pointInBoundary(place.coordinates[0], place.coordinates[1]))
        .map((place) => {
            const element = document.createElement("div");
            element.className = `gombe-place-marker ${place.type} rank-${place.rank}`;
            element.innerHTML = `<span class="place-leader"></span><i class="place-pin"></i><span class="place-label-text">${escapeHtml(place.name)}</span>`;
            layer.appendChild(element);
            return {
                ...place,
                element,
                labelElement: element.querySelector(".place-label-text"),
                leaderElement: element.querySelector(".place-leader"),
            };
        });
    updatePlaceLabels();
}

function rectanglesOverlap(first, second, padding = 4) {
    return !(first.right + padding < second.left
        || first.left - padding > second.right
        || first.bottom + padding < second.top
        || first.top - padding > second.bottom);
}

function updatePlaceLabels() {
    if (!state.placeLabels.length) return;
    const width = map.getContainer().clientWidth;
    const height = map.getContainer().clientHeight;
    const topSafe = width >= 620 ? 68 : 56;
    const edge = 7;
    const accepted = [];
    const ordered = [...state.placeLabels].sort((first, second) => first.rank - second.rank || first.name.localeCompare(second.name));

    function overlapArea(first, second) {
        const overlapWidth = Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left));
        const overlapHeight = Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));
        return overlapWidth * overlapHeight;
    }

    function candidateOffsets(labelWidth, labelHeight) {
        const gap = 9;
        return [
            [gap, -labelHeight - gap],
            [gap, gap],
            [-labelWidth - gap, -labelHeight - gap],
            [-labelWidth - gap, gap],
            [-labelWidth / 2, -labelHeight - 15],
            [-labelWidth / 2, 15],
            [18, -labelHeight / 2],
            [-labelWidth - 18, -labelHeight / 2],
        ];
    }

    for (const place of ordered) {
        const point = map.project(place.coordinates);
        const inViewport = point.x > edge && point.x < width - edge && point.y > topSafe && point.y < height - edge;
        if (!inViewport) {
            place.element.style.display = "none";
            continue;
        }

        place.element.style.display = "block";
        place.element.style.transform = `translate(${point.x}px, ${point.y}px)`;
        const labelWidth = Math.max(42, place.labelElement.offsetWidth || place.name.length * (place.rank === 1 ? 7.2 : 6.0) + 18);
        const labelHeight = Math.max(17, place.labelElement.offsetHeight || (place.rank === 1 ? 22 : 18));
        const candidates = candidateOffsets(labelWidth, labelHeight);

        for (let radius = 30; radius <= 96; radius += 14) {
            for (let angle = 0; angle < 360; angle += 45) {
                const radians = angle * Math.PI / 180;
                candidates.push([
                    Math.cos(radians) * radius - labelWidth / 2,
                    Math.sin(radians) * radius - labelHeight / 2,
                ]);
            }
        }

        let selected = null;
        let selectedScore = Number.POSITIVE_INFINITY;
        for (const [offsetX, offsetY] of candidates) {
            const rectangle = {
                left: point.x + offsetX,
                right: point.x + offsetX + labelWidth,
                top: point.y + offsetY,
                bottom: point.y + offsetY + labelHeight,
            };
            const outside = rectangle.left < edge || rectangle.right > width - edge || rectangle.top < topSafe || rectangle.bottom > height - edge;
            if (outside) continue;
            const score = accepted.reduce((sum, existing) => sum + overlapArea(rectangle, existing), 0);
            if (score < selectedScore) {
                selected = { offsetX, offsetY, rectangle };
                selectedScore = score;
                if (score === 0) break;
            }
        }

        if (!selected) {
            const offsetX = Math.max(edge - point.x, Math.min(width - edge - point.x - labelWidth, 10));
            const offsetY = Math.max(topSafe - point.y, Math.min(height - edge - point.y - labelHeight, 10));
            selected = {
                offsetX,
                offsetY,
                rectangle: {
                    left: point.x + offsetX,
                    right: point.x + offsetX + labelWidth,
                    top: point.y + offsetY,
                    bottom: point.y + offsetY + labelHeight,
                },
            };
        }

        place.labelElement.style.transform = `translate(${selected.offsetX}px, ${selected.offsetY}px)`;
        const labelCentreX = selected.offsetX + labelWidth / 2;
        const labelCentreY = selected.offsetY + labelHeight / 2;
        const leaderLength = Math.max(5, Math.hypot(labelCentreX, labelCentreY) - Math.min(labelWidth, labelHeight) * 0.32);
        const leaderAngle = Math.atan2(labelCentreY, labelCentreX);
        place.leaderElement.style.width = `${leaderLength}px`;
        place.leaderElement.style.transform = `rotate(${leaderAngle}rad)`;
        accepted.push(selected.rectangle);
    }
}

function updateSpatialOverlays() {
    buildScreenMaskPath();
    updatePlaceLabels();
}

async function addBoundary() {
    try {
        const response = await fetch("/api/boundary", { cache: "no-store" });
        if (!response.ok) throw new Error(`Boundary request failed: ${response.status}`);
        const boundary = await response.json();
        const polygons = normaliseBoundaryPolygons(boundary);
        if (!polygons.length) throw new Error("Boundary response contained no polygon geometry");

        state.boundaryPolygons = polygons;
        state.boundaryBounds = calculateBoundaryBounds(polygons);
        state.boundaryReady = true;
        hideBasemapLabels();
        dustField.setBoundary(boundary);

        map.addSource("gombe-outside-mask", { type: "geojson", data: createOutsideMaskGeoJson(polygons) });
        map.addLayer({
            id: "gombe-outside-mask",
            type: "fill",
            source: "gombe-outside-mask",
            paint: {
                "fill-color": "#020910",
                "fill-opacity": 0.985,
                "fill-antialias": true,
            },
        });

        map.addSource("gombe-boundary", { type: "geojson", data: boundary });
        map.addLayer({
            id: "gombe-boundary-fill",
            type: "fill",
            source: "gombe-boundary",
            paint: { "fill-color": "#74cbb2", "fill-opacity": 0.075 },
        });
        map.addLayer({
            id: "gombe-boundary-glow",
            type: "line",
            source: "gombe-boundary",
            paint: { "line-color": "#5ee2d3", "line-width": 7, "line-opacity": 0.18, "line-blur": 4 },
        });
        map.addLayer({
            id: "gombe-boundary-line",
            type: "line",
            source: "gombe-boundary",
            paint: { "line-color": "#b5fff6", "line-width": 1.8, "line-opacity": 0.94, "line-dasharray": [2, 1.2] },
        });

        createPlaceLabels();
        focusGombeBoundary(0);
        updateSpatialOverlays();
        map.on("render", updateSpatialOverlays);
        window.addEventListener("resize", () => { map.resize(); updateSpatialOverlays(); });
    } catch (error) {
        console.warn("Boundary layer unavailable", error);
        showToast("Boundary unavailable; using protected Gombe fallback view");
    }
}


function lgaDisplayName(properties = {}) {
    return String(properties.lga_name || properties.shapeName || properties.shape_name || properties.name || "Local Government Area");
}

function geometryRepresentativePoint(geometry) {
    if (!geometry) return [11.1673, 10.2897];
    if (geometry.type === "Point") return geometry.coordinates;
    const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : [];
    const points = polygons.flatMap((polygon) => polygon?.[0] || []);
    if (!points.length) return [11.1673, 10.2897];
    const totals = points.reduce((accumulator, coordinate) => [
        accumulator[0] + Number(coordinate[0] || 0),
        accumulator[1] + Number(coordinate[1] || 0),
    ], [0, 0]);
    return [totals[0] / points.length, totals[1] / points.length];
}

function stableNameFactor(name) {
    let hash = 2166136261;
    for (const character of String(name)) {
        hash ^= character.charCodeAt(0);
        hash = Math.imul(hash, 16777619);
    }
    return ((hash >>> 0) % 1000) / 1000;
}

function aqiCategoryAndColor(aqi) {
    if (aqi <= 50) return { category: "Good", color: "#43d17c" };
    if (aqi <= 100) return { category: "Moderate", color: "#f0d34f" };
    if (aqi <= 150) return { category: "Unhealthy for sensitive groups", color: "#ff963f" };
    if (aqi <= 200) return { category: "Unhealthy", color: "#ef4f58" };
    return { category: "Very unhealthy", color: "#8c4ab8" };
}

function localHealthRecommendation(aqi) {
    if (aqi <= 50) return "Air quality is suitable for normal outdoor activity.";
    if (aqi <= 100) return "Sensitive residents should monitor symptoms during prolonged outdoor activity.";
    if (aqi <= 150) return "Children, older adults and people with respiratory conditions should reduce prolonged outdoor exertion.";
    if (aqi <= 200) return "Reduce outdoor exposure, close windows during high particle periods and use suitable respiratory protection when necessary.";
    return "Avoid non-essential outdoor exposure. Vulnerable residents should remain indoors with cleaner air and follow local health advice.";
}

function calculateLocalLgaMetrics(name, frame, coordinate = [11.1673, 10.2897]) {
    const seed = stableNameFactor(name);
    const longitudeInfluence = Math.sin(Number(coordinate[0]) * 3.1 + seed * 5.7) * 0.055;
    const latitudeInfluence = Math.cos(Number(coordinate[1]) * 3.7 + seed * 4.3) * 0.045;
    const spatialFactor = Math.max(0.78, Math.min(1.22, 0.88 + seed * 0.24 + longitudeInfluence + latitudeInfluence));
    const pm25 = Math.max(0, Number(frame.air_quality?.pm25 || 0) * spatialFactor);
    const pm10 = Math.max(0, Number(frame.air_quality?.pm10 || 0) * (spatialFactor * 0.96 + 0.035));
    const aqi = Math.max(0, Math.min(500, Math.round(Number(frame.air_quality?.aqi || 0) * (0.9 + seed * 0.2))));
    const temperature = Number(frame.weather?.temperature_c || 0) + (seed - 0.5) * 2.2;
    const humidity = Math.max(0, Math.min(100, Number(frame.weather?.humidity_pct || 0) + (0.5 - seed) * 8));
    const windSpeed = Math.max(0, Number(frame.weather?.wind_speed_ms || 0) * (0.9 + seed * 0.18));
    const windDirection = (Number(frame.weather?.wind_direction_deg || 0) + (seed - 0.5) * 18 + 360) % 360;
    const severity = aqiCategoryAndColor(aqi);
    return {
        aqi,
        category: severity.category,
        color: severity.color,
        pm25,
        pm10,
        temperature,
        humidity,
        windSpeed,
        windDirection,
        healthRecommendation: localHealthRecommendation(aqi),
    };
}

function enrichLgaCollection(frame) {
    return {
        type: "FeatureCollection",
        features: state.lgaFeatures.map((feature, index) => {
            const name = lgaDisplayName(feature.properties);
            const coordinate = geometryRepresentativePoint(feature.geometry);
            const metrics = calculateLocalLgaMetrics(name, frame, coordinate);
            return {
                ...feature,
                id: feature.id ?? index,
                properties: {
                    ...(feature.properties || {}),
                    lga_name: name,
                    local_aqi: metrics.aqi,
                    local_pm25: Number(metrics.pm25.toFixed(1)),
                    local_pm10: Number(metrics.pm10.toFixed(1)),
                    local_temperature: Number(metrics.temperature.toFixed(1)),
                    local_humidity: Number(metrics.humidity.toFixed(0)),
                    local_wind_speed: Number(metrics.windSpeed.toFixed(1)),
                    local_wind_direction: Number(metrics.windDirection.toFixed(0)),
                    local_category: metrics.category,
                    local_color: metrics.color,
                },
            };
        }),
    };
}

function renderLgaCard(name, frame, coordinate) {
    if (!frame) return;
    const metrics = calculateLocalLgaMetrics(name, frame, coordinate);
    state.selectedLgaName = name;
    setText("lga-name", name);
    setText("lga-aqi", metrics.aqi);
    setText("lga-aqi-category", metrics.category);
    setText("lga-pm25", metrics.pm25.toFixed(1));
    setText("lga-pm10", metrics.pm10.toFixed(1));
    setText("lga-temperature", metrics.temperature.toFixed(1));
    setText("lga-humidity", metrics.humidity.toFixed(0));
    setText("lga-wind", `${metrics.windSpeed.toFixed(1)} m/s · ${compassDirection(metrics.windDirection)} · ${metrics.windDirection.toFixed(0)}°`);
    setText("lga-health-recommendation", metrics.healthRecommendation);
    setText("lga-updated", `Updated: ${formatGombeTimestamp(frame.generated_at)}`);
    elements["lga-aqi-orb"]?.style.setProperty("--lga-aqi-color", metrics.color);
    elements["lga-info-card"]?.classList.add("open");
    elements["lga-info-card"]?.setAttribute("aria-hidden", "false");
    if (map.getLayer("lga-selected-line")) map.setFilter("lga-selected-line", ["==", ["get", "lga_name"], name]);
    if (map.getLayer("lga-selected-point")) map.setFilter("lga-selected-point", ["==", ["get", "lga_name"], name]);
}

function closeLgaCard() {
    state.selectedLgaName = null;
    elements["lga-info-card"]?.classList.remove("open");
    elements["lga-info-card"]?.setAttribute("aria-hidden", "true");
    if (map.getLayer("lga-selected-line")) map.setFilter("lga-selected-line", ["==", ["get", "lga_name"], "__none__"]);
    if (map.getLayer("lga-selected-point")) map.setFilter("lga-selected-point", ["==", ["get", "lga_name"], "__none__"]);
}

function hasPolygonLgaFeatures(features) {
    return features.some((feature) => ["Polygon", "MultiPolygon"].includes(feature?.geometry?.type));
}

async function refreshLgaData(attempt = 0) {
    if (attempt >= 3 || hasPolygonLgaFeatures(state.lgaFeatures)) return;
    try {
        const response = await fetch("/api/lgas", { cache: "no-store" });
        if (!response.ok) throw new Error(`LGA refresh failed: ${response.status}`);
        const collection = await response.json();
        const features = Array.isArray(collection.features) ? collection.features : [];
        if (features.length) {
            state.lgaFeatures = features;
            const source = map.getSource("gombe-lgas");
            if (source) source.setData(state.frame ? enrichLgaCollection(state.frame) : collection);
        }
    } catch (error) {
        console.warn("Deferred LGA refresh failed", error);
    }
    if (!hasPolygonLgaFeatures(state.lgaFeatures)) {
        window.setTimeout(() => refreshLgaData(attempt + 1), 5000);
    }
}

async function addLgaLayers() {
    try {
        const response = await fetch("/api/lgas", { cache: "no-store" });
        if (!response.ok) throw new Error(`LGA request failed: ${response.status}`);
        const collection = await response.json();
        state.lgaFeatures = Array.isArray(collection.features) ? collection.features : [];
        if (!state.lgaFeatures.length) return;
        const initialData = state.frame ? enrichLgaCollection(state.frame) : collection;
        map.addSource("gombe-lgas", { type: "geojson", data: initialData, generateId: true });
        const aqiColorExpression = [
            "interpolate", ["linear"], ["coalesce", ["get", "local_aqi"], 0],
            0, "#43d17c", 50, "#43d17c", 100, "#f0d34f", 150, "#ff963f", 200, "#ef4f58", 300, "#8c4ab8",
        ];
        map.addLayer({
            id: "lga-fill",
            type: "fill",
            source: "gombe-lgas",
            filter: ["==", ["geometry-type"], "Polygon"],
            paint: { "fill-color": aqiColorExpression, "fill-opacity": 0.09 },
        });
        map.addLayer({
            id: "lga-line",
            type: "line",
            source: "gombe-lgas",
            filter: ["==", ["geometry-type"], "Polygon"],
            paint: { "line-color": aqiColorExpression, "line-width": 1.05, "line-opacity": 0.58 },
        });
        map.addLayer({
            id: "lga-selected-line",
            type: "line",
            source: "gombe-lgas",
            filter: ["==", ["get", "lga_name"], "__none__"],
            paint: { "line-color": "#ffffff", "line-width": 3, "line-opacity": 0.95, "line-blur": 0.3 },
        });
        map.addLayer({
            id: "lga-points",
            type: "circle",
            source: "gombe-lgas",
            filter: ["==", ["geometry-type"], "Point"],
            paint: {
                "circle-radius": 8,
                "circle-color": aqiColorExpression,
                "circle-opacity": 0.82,
                "circle-stroke-color": "#ffffff",
                "circle-stroke-width": 1.5,
            },
        });
        map.addLayer({
            id: "lga-selected-point",
            type: "circle",
            source: "gombe-lgas",
            filter: ["==", ["get", "lga_name"], "__none__"],
            paint: { "circle-radius": 13, "circle-color": "rgba(255,255,255,0.08)", "circle-stroke-color": "#ffffff", "circle-stroke-width": 2.5 },
        });

        const interactiveLayers = ["lga-fill", "lga-points"];
        for (const layerId of interactiveLayers) {
            map.on("mouseenter", layerId, () => { map.getCanvas().style.cursor = "pointer"; });
            map.on("mouseleave", layerId, () => { map.getCanvas().style.cursor = ""; });
            map.on("click", layerId, (event) => {
                const feature = event.features?.[0];
                if (!feature) return;
                const name = lgaDisplayName(feature.properties);
                renderLgaCard(name, state.frame, geometryRepresentativePoint(feature.geometry));
            });
        }
        if (!hasPolygonLgaFeatures(state.lgaFeatures)) {
            window.setTimeout(() => refreshLgaData(0), 5000);
        }
    } catch (error) {
        console.warn("LGA layer unavailable", error);
        showToast("LGA boundaries are temporarily unavailable");
    }
}

function updateLgaLayer(frame) {
    const source = map.getSource("gombe-lgas");
    if (!source || !state.lgaFeatures.length) return;
    const now = Date.now();
    const updateInterval = state.platformMode === "mobile" ? 5000 : state.platformMode === "tablet" ? 3500 : 2000;
    if (now - state.lastLgaMapUpdate >= updateInterval) {
        state.lastLgaMapUpdate = now;
        source.setData(enrichLgaCollection(frame));
    }
    if (state.selectedLgaName) {
        const feature = state.lgaFeatures.find((item) => lgaDisplayName(item.properties) === state.selectedLgaName);
        if (feature) renderLgaCard(state.selectedLgaName, frame, geometryRepresentativePoint(feature.geometry));
    }
}

function addDynamicLayers() {
    map.addSource("air-sensors", { type: "geojson", data: emptyFeatureCollection() });
    map.addLayer({
        id: "dust-heat",
        type: "heatmap",
        source: "air-sensors",
        maxzoom: 12,
        paint: {
            "heatmap-weight": ["interpolate", ["linear"], ["get", "pm10"], 0, 0, 250, 1],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 1.45],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 5, 34, 10, 82],
            "heatmap-opacity": 0.32,
            "heatmap-color": [
                "interpolate", ["linear"], ["heatmap-density"],
                0, "rgba(255,195,92,0)",
                0.25, "rgba(255,195,92,0.13)",
                0.55, "rgba(255,145,77,0.25)",
                0.8, "rgba(255,93,102,0.34)",
                1, "rgba(184,62,73,0.42)",
            ],
        },
    });
    map.addLayer({
        id: "sensor-halo",
        type: "circle",
        source: "air-sensors",
        paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "pm25"], 0, 11, 200, 28],
            "circle-color": "#43d7d2",
            "circle-opacity": 0.09,
            "circle-blur": 0.45,
        },
    });
    map.addLayer({
        id: "sensor-points",
        type: "circle",
        source: "air-sensors",
        paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "pm25"], 0, 4, 200, 9],
            "circle-color": [
                "interpolate", ["linear"], ["get", "pm25"],
                0, "#5fe6a4", 35, "#f3d45e", 75, "#ff914d", 150, "#ff5d66",
            ],
            "circle-stroke-width": 1.5,
            "circle-stroke-color": "rgba(225,255,255,0.8)",
            "circle-opacity": 0.92,
        },
    });

    map.addSource("fire-hotspots", { type: "geojson", data: emptyFeatureCollection() });
    map.addLayer({
        id: "fire-heat",
        type: "heatmap",
        source: "fire-hotspots",
        maxzoom: 12,
        paint: {
            "heatmap-weight": ["interpolate", ["linear"], ["get", "frp"], 0, 0, 80, 1],
            "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 5, 0.5, 10, 1.6],
            "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 5, 24, 10, 58],
            "heatmap-opacity": 0.24,
            "heatmap-color": [
                "interpolate", ["linear"], ["heatmap-density"],
                0, "rgba(255,198,91,0)",
                0.25, "rgba(255,198,91,0.14)",
                0.5, "rgba(255,131,72,0.28)",
                0.8, "rgba(255,93,102,0.4)",
                1, "rgba(156,32,48,0.55)"
            ]
        },
    });
    map.addLayer({
        id: "fire-glow",
        type: "circle",
        source: "fire-hotspots",
        paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "frp"], 0, 10, 50, 34],
            "circle-color": "#ff5d66",
            "circle-opacity": 0.16,
            "circle-blur": 0.58,
        },
    });
    map.addLayer({
        id: "fire-points",
        type: "circle",
        source: "fire-hotspots",
        paint: {
            "circle-radius": ["interpolate", ["linear"], ["get", "frp"], 0, 4, 50, 10],
            "circle-color": "#ff784f",
            "circle-stroke-color": "#ffd166",
            "circle-stroke-width": 1.2,
            "circle-opacity": 0.92,
        },
    });

    map.addSource("wind-field", { type: "geojson", data: emptyFeatureCollection() });
    map.addLayer({
        id: "wind-lines",
        type: "line",
        source: "wind-field",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: {
            "line-color": "#b7fff3",
            "line-opacity": 0.23,
            "line-width": ["interpolate", ["linear"], ["get", "speed"], 0, 0.5, 15, 1.8],
            "line-dasharray": [1.5, 3.5],
        },
    });
    map.addLayer({
        id: "wind-arrows",
        type: "symbol",
        source: "wind-field",
        filter: ["==", ["geometry-type"], "Point"],
        layout: {
            "text-field": "➤",
            "text-size": ["interpolate", ["linear"], ["get", "speed"], 0, 8, 15, 14],
            "text-rotate": ["get", "rotation"],
            "text-rotation-alignment": "map",
            "text-allow-overlap": true,
        },
        paint: {
            "text-color": "#b7fff3",
            "text-opacity": 0.55,
            "text-halo-color": "rgba(6,16,25,.75)",
            "text-halo-width": 1,
        },
    });

    map.on("mouseenter", "sensor-points", () => { map.getCanvas().style.cursor = "pointer"; });
    map.on("mouseleave", "sensor-points", () => { map.getCanvas().style.cursor = ""; });
    map.on("click", "sensor-points", (event) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const props = feature.properties;
        new maplibregl.Popup({ closeButton: false, offset: 12 })
            .setLngLat(feature.geometry.coordinates)
            .setHTML(
                `<div class="popup-title">${escapeHtml(props.name)}</div>`
                + `<div class="popup-row"><span>PM2.5</span><b>${Number(props.pm25).toFixed(1)} µg/m³</b></div>`
                + `<div class="popup-row"><span>PM10</span><b>${Number(props.pm10).toFixed(1)} µg/m³</b></div>`
                + `<div class="popup-row"><span>Source</span><b>${escapeHtml(props.source)}</b></div>`,
            )
            .addTo(map);
    });
}

function createRadarMarkers() {
    state.radarMarkers = RADARS
        .filter((radar) => pointInBoundary(radar.coordinates[0], radar.coordinates[1]))
        .map((radar, index) => {
            const element = document.createElement("div");
            element.className = "radar-marker";
            element.innerHTML = `<div class="radar-rings"></div><div class="radar-beam" style="animation-delay:${-index * 0.7}s"></div><span class="radar-label">${radar.name}</span>`;
            element.setAttribute("title", radar.name);
            return new maplibregl.Marker({ element, anchor: "center" }).setLngLat(radar.coordinates).addTo(map);
        });
}

function emptyFeatureCollection() {
    return { type: "FeatureCollection", features: [] };
}

function scopedStations(frame) {
    return (frame.air_quality?.stations || []).filter((station) => pointInBoundary(
        Number(station.longitude),
        Number(station.latitude),
    ));
}

function scopedHotspots(frame) {
    return (frame.hotspots || []).filter((hotspot) => pointInBoundary(
        Number(hotspot.longitude),
        Number(hotspot.latitude),
    ));
}

function scopeFrameToGombe(frame) {
    const stations = scopedStations(frame);
    const hotspots = scopedHotspots(frame);
    return {
        ...frame,
        air_quality: { ...frame.air_quality, stations },
        hotspots,
    };
}

function updateMap(frame) {
    if (!state.mapReady || !map.getSource("air-sensors")) return;
    const sensors = scopedStations(frame);
    const hotspots = scopedHotspots(frame);
    map.getSource("air-sensors").setData({
        type: "FeatureCollection",
        features: sensors.map((station) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [Number(station.longitude), Number(station.latitude)] },
            properties: {
                name: station.name,
                pm25: station.pm25,
                pm10: station.pm10,
                source: station.source,
            },
        })),
    });

    map.getSource("fire-hotspots").setData({
        type: "FeatureCollection",
        features: hotspots.map((hotspot) => ({
            type: "Feature",
            geometry: { type: "Point", coordinates: [Number(hotspot.longitude), Number(hotspot.latitude)] },
            properties: { frp: hotspot.frp, confidence: hotspot.confidence },
        })),
    });
    map.getSource("wind-field").setData(createWindField(frame.weather.wind_direction_deg, frame.weather.wind_speed_ms));
    updateLgaLayer(frame);

    if (map.getLayer("dust-heat")) {
        const dustSeverity = Number(frame.derived?.dust_index) || 0;
        const opacity = 0.05 + 0.34 * Math.pow(Math.max(0, Math.min(100, dustSeverity)) / 100, 1.35);
        map.setPaintProperty("dust-heat", "heatmap-opacity", state.particlesEnabled ? opacity : 0);
    }
    if (map.getLayer("fire-heat")) {
        const maxFrp = Math.max(0, ...hotspots.map((hotspot) => Number(hotspot.frp) || 0));
        const thermalOpacity = hotspots.length ? 0.1 + Math.min(0.3, maxFrp / 220) : 0.025;
        map.setPaintProperty("fire-heat", "heatmap-opacity", state.heatEnabled ? thermalOpacity : 0);
    }
}

function createWindField(direction, speed) {
    const features = [];
    const transportDirection = (direction + 180) % 360;
    const bearing = (90 - transportDirection) * Math.PI / 180;
    const length = 0.04 + Math.min(0.12, speed * 0.0065);
    const bounds = state.boundaryBounds;
    const gridDivisor = state.platformMode === "mobile" ? 4.2 : state.platformMode === "tablet" ? 5.4 : 7;
    const minimumStep = state.platformMode === "mobile" ? 0.34 : state.platformMode === "tablet" ? 0.27 : 0.22;
    const longitudeStep = Math.max(minimumStep, (bounds.east - bounds.west) / gridDivisor);
    const latitudeStep = Math.max(minimumStep, (bounds.north - bounds.south) / gridDivisor);
    for (let latitude = bounds.south; latitude <= bounds.north; latitude += latitudeStep) {
        for (let longitude = bounds.west; longitude <= bounds.east; longitude += longitudeStep) {
            if (!pointInBoundary(longitude, latitude)) continue;
            const jitter = Math.sin(latitude * 7 + longitude * 5) * 5;
            const localBearing = bearing + jitter * Math.PI / 180;
            const end = [
                longitude + Math.cos(localBearing) * length,
                latitude + Math.sin(localBearing) * length,
            ];
            const clippedEnd = pointInBoundary(end[0], end[1])
                ? end
                : [
                    longitude + Math.cos(localBearing) * length * 0.45,
                    latitude + Math.sin(localBearing) * length * 0.45,
                ];
            features.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: [[longitude, latitude], clippedEnd] },
                properties: { speed },
            });
            features.push({
                type: "Feature",
                geometry: { type: "Point", coordinates: clippedEnd },
                properties: { speed, rotation: transportDirection + jitter },
            });
        }
    }
    return { type: "FeatureCollection", features };
}

function connectSocket() {
    const protocol = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${protocol}://${location.host}/ws/live`);
    state.socket = socket;
    setSocketStatus("connecting");

    socket.addEventListener("open", () => {
        state.reconnectAttempt = 0;
        setSocketStatus("online");
        showToast("Live WebSocket telemetry connected");
    });

    socket.addEventListener("message", (event) => {
        try {
            const frame = JSON.parse(event.data);
            state.previousFrame = state.frame;
            state.frame = frame;
            renderFrame(frame, state.previousFrame);
        } catch (error) {
            console.error("Invalid telemetry frame", error);
        }
    });

    socket.addEventListener("close", () => {
        setSocketStatus("offline");
        const delay = Math.min(15000, 1000 * 2 ** state.reconnectAttempt);
        state.reconnectAttempt += 1;
        window.setTimeout(connectSocket, delay);
    });

    socket.addEventListener("error", () => socket.close());
}

window.setInterval(() => {
    if (state.socket?.readyState === WebSocket.OPEN) state.socket.send("ping");
}, 15000);

function setSocketStatus(status) {
    elements["socket-dot"].className = `status-dot ${status}`;
    elements["stream-status"].textContent = status.toUpperCase();
}

function renderFrame(frame, previous) {
    const scopedFrame = scopeFrameToGombe(frame);
    const scopedPrevious = previous ? scopeFrameToGombe(previous) : null;
    const pm25Delta = scopedPrevious ? scopedFrame.air_quality.pm25 - scopedPrevious.air_quality.pm25 : 0;
    const pm10Delta = scopedPrevious ? scopedFrame.air_quality.pm10 - scopedPrevious.air_quality.pm10 : 0;
    const generatedAt = new Date(frame.generated_at);
    const packetAge = Math.max(0, Date.now() - generatedAt.getTime());
    const dewPoint = calculateDewPoint(frame.weather.temperature_c, frame.weather.humidity_pct);
    const transportDirection = (frame.weather.wind_direction_deg + 180) % 360;
    const gustFactor = frame.weather.wind_speed_ms > 0 ? frame.weather.wind_gust_ms / frame.weather.wind_speed_ms : 0;
    const hotspotFrpValues = scopedFrame.hotspots.map((hotspot) => Number(hotspot.frp) || 0);
    const totalFrp = hotspotFrpValues.reduce((sum, value) => sum + value, 0);
    const peakFrp = hotspotFrpValues.length ? Math.max(...hotspotFrpValues) : 0;
    const thermalIntensity = Math.min(100, hotspotFrpValues.length * 10 + totalFrp * 0.75);
    const surfaceHeatLoad = Math.min(100, frame.weather.temperature_c * 2 + totalFrp * 0.35 + frame.air_quality.pm10 * 0.08);
    const apparentTemperature = calculateApparentTemperature(
        frame.weather.temperature_c,
        frame.weather.humidity_pct,
        frame.weather.wind_speed_ms,
    );
    const ambientHeat = Math.max(0, Math.min(100, (frame.weather.temperature_c - 15) / 30 * 100));
    const radianceIndex = Math.max(0, Math.min(100,
        frame.air_quality.pm25 * 0.25
        + frame.air_quality.pm10 * 0.17
        + frame.derived.dust_index * 0.48
        + totalFrp * 0.18,
    ));
    const thermalStress = Math.max(0, Math.min(100,
        ambientHeat * 0.42
        + surfaceHeatLoad * 0.28
        + thermalIntensity * 0.18
        + Math.max(0, apparentTemperature - 24) * 1.4,
    ));
    const exposureLoad = Math.max(0, Math.min(100,
        thermalStress * 0.42
        + frame.derived.health_risk * 0.34
        + frame.derived.dust_index * 0.24,
    ));

    dustField.setTelemetry(scopedFrame);
    windField.setTelemetry(scopedFrame);
    heatField.setTelemetry(scopedFrame, { surfaceHeatLoad, thermalIntensity, peakFrp });

    setText("frame-sequence", String(frame.sequence).padStart(6, "0"));
    setText("packet-age", `${Math.round(packetAge)} ms`);
    const updatedLabel = `Last updated: ${formatGombeTimestamp(frame.generated_at)}`;
    setText("last-updated", updatedLabel);
    setText("map-last-updated", updatedLabel);
    setText("pm25-value", frame.air_quality.pm25.toFixed(1));
    setText("pm10-value", frame.air_quality.pm10.toFixed(1));
    setText("pm25-delta", formatDelta(pm25Delta));
    setText("pm10-delta", formatDelta(pm10Delta));
    setText("aqi-value", frame.air_quality.aqi);
    setText("aqi-category", frame.air_quality.category);
    setText("aqi-guidance", guidanceForAqi(frame.air_quality.aqi));

    setText("temperature", frame.weather.temperature_c.toFixed(1));
    setText("condition", frame.weather.condition);
    setText("weather-symbol", weatherSymbol(frame.weather));
    setText("wind-speed", frame.weather.wind_speed_ms.toFixed(1));
    setText("wind-bearing", `${compassDirection(frame.weather.wind_direction_deg)} · FROM ${frame.weather.wind_direction_deg.toFixed(0)}°`);
    elements["wind-arrow"].style.transform = `rotate(${frame.weather.wind_direction_deg}deg)`;
    setText("gust-speed", frame.weather.wind_gust_ms.toFixed(1));
    setText("humidity", frame.weather.humidity_pct.toFixed(0));
    setText("humidity-state", humidityState(frame.weather.humidity_pct));
    setText("pressure", frame.weather.pressure_hpa.toFixed(0));
    setText("dew-point", dewPoint.toFixed(1));
    setText("cloud-cover", Number(frame.weather.cloud_cover_pct || 0).toFixed(0));
    setText("visibility", frame.derived.visibility_estimate_km.toFixed(1));
    setText("rainfall", Number(frame.weather.precipitation_mm_1h || 0).toFixed(2));
    setText("beaufort-label", beaufortDescription(frame.weather.wind_speed_ms));
    setText("observed-age", observationAge(frame.weather.observed_at));

    setText("weather-source", frame.sources.weather);
    setText("air-source", frame.sources.air_quality);
    setText("firms-source", frame.sources.firms);
    setText("dust-index", Math.round(frame.derived.dust_index));
    setText("health-risk", frame.derived.health_risk);
    setText("aviation-risk", frame.derived.aviation_risk);
    setText("alert-message", frame.derived.alert_message);
    setText("alert-label", `${frame.derived.alert_level.toUpperCase()} STATUS`);
    setText("sensor-count", scopedFrame.air_quality.stations.length);
    setText("dispersion-score", `${Math.round(frame.derived.dispersion_score)}%`);
    setText("gust-factor", `${gustFactor.toFixed(2)}×`);
    setText("particle-count", dustField.targetCount.toLocaleString());
    setText("wind-line-count", windField.targetCount.toLocaleString());
    setText("transport-bearing", `${compassDirection(transportDirection)} · ${transportDirection.toFixed(0)}°`);
    setText("wind-card-state", `${windState(frame.weather.wind_speed_ms)} transporting dust ${compassDirection(transportDirection)}`);
    setText("wind-chart-value", `${frame.weather.wind_speed_ms.toFixed(1)} m/s`);
    setText("hotspot-count", scopedFrame.hotspots.length);
    setText("hotspot-updated", scopedFrame.hotspots.length ? `Latest Gombe layer: ${formatTime(frame.generated_at)}` : "No active hotspots inside Gombe State");
    setText("connected-clients", frame.connected_clients);
    setText("map-subtitle", `${dustField.targetCount.toLocaleString()} severity-scaled dust points · ${Math.round(dustField.severity)}% dust severity · ${scopedFrame.air_quality.stations.length} Gombe sensor nodes`);
    setText("map-thermal-state", thermalStatusForValue(thermalStress).label);
    setText("map-ambient-value", `${Math.round(ambientHeat)}%`);
    setText("map-radiance-value", `${Math.round(radianceIndex)}%`);
    setText("map-frp-value", `${peakFrp.toFixed(1)} MW`);
    setText("map-exposure-value", `${Math.round(exposureLoad)}%`);
    setMeter("map-ambient-fill", ambientHeat);
    setMeter("map-radiance-fill", radianceIndex);
    setMeter("map-frp-fill", Math.min(100, peakFrp * 1.8));
    setMeter("map-exposure-fill", exposureLoad);

    elements["thermal-fill"].style.width = `${Math.min(100, scopedFrame.hotspots.length * 8 + 8)}%`;
    setMeter("thermal-intensity-fill", thermalIntensity);
    setMeter("peak-frp-fill", Math.min(100, peakFrp * 1.8));
    setMeter("surface-heat-fill", surfaceHeatLoad);
    setText("thermal-intensity", `${Math.round(thermalIntensity)}%`);
    setText("peak-frp", `${peakFrp.toFixed(1)} MW`);
    setText("surface-heat", `${Math.round(surfaceHeatLoad)}%`);

    const thermalStatus = thermalStatusForValue(thermalStress);
    setText("thermal-state", thermalStatus.label);
    elements["thermal-state"].className = `thermal-state ${thermalStatus.className}`;
    setText("thermal-stress", Math.round(thermalStress));
    setText("thermal-ambient", frame.weather.temperature_c.toFixed(1));
    setText("apparent-temperature", apparentTemperature.toFixed(1));
    setText("radiance-index", Math.round(radianceIndex));
    setText("spark-count", dustField.radiantCount.toLocaleString());
    setText("ambient-heat-value", `${Math.round(ambientHeat)}%`);
    setText("ambient-heat-label", ambientHeatLabel(ambientHeat));
    setText("radiance-value", `${Math.round(radianceIndex)}%`);
    setText("frp-heat-value", `${peakFrp.toFixed(1)} MW`);
    setText("thermal-hotspot-count", scopedFrame.hotspots.length);
    setText("exposure-value", `${Math.round(exposureLoad)}%`);
    setVerticalMeter("ambient-heat-fill", ambientHeat);
    setVerticalMeter("radiance-fill", radianceIndex);
    setVerticalMeter("frp-heat-fill", Math.min(100, peakFrp * 1.8));
    setVerticalMeter("exposure-fill", exposureLoad);
    setThermalCore(thermalStress, thermalStatus.color);
    document.documentElement.style.setProperty("--live-thermal", `${thermalStress}`);
    document.documentElement.style.setProperty("--live-radiance", `${radianceIndex}`);
    document.documentElement.style.setProperty("--dust-severity", `${dustField.severity}`);
    appShell.classList.remove("data-pulse");
    void appShell.offsetWidth;
    appShell.classList.add("data-pulse");

    updateMode(frame.mode);
    updateRisk(frame.derived);
    updateAqiStyle(frame.air_quality.aqi);
    updateMap(scopedFrame);
    charts.push(frame);
}

function updateMode(mode) {
    elements["mode-badge"].textContent = mode.toUpperCase();
    elements["mode-badge"].className = `mode-badge ${mode}`;
}

function updateRisk(derived) {
    const level = derived.alert_level;
    elements["risk-level"].textContent = level.toUpperCase();
    elements["risk-level"].className = `risk-level ${level}`;
    elements["alert-card"].className = `alert-card ${level}`;
    setGauge(elements["dust-gauge"], derived.dust_index);
    setGauge(elements["health-gauge"], derived.health_risk);
    setGauge(elements["aviation-gauge"], derived.aviation_risk);
}

function setGauge(element, value) {
    const bounded = Math.max(0, Math.min(100, value));
    element.style.setProperty("--value", bounded);
    const color = bounded >= 80 ? "#ff5d66" : bounded >= 60 ? "#ff8548" : bounded >= 35 ? "#ffc35c" : "#6ce7a5";
    element.style.setProperty("--gauge-color", color);
}

function updateAqiStyle(aqi) {
    const color = aqi > 200 ? "#ff5d66" : aqi > 150 ? "#ff754f" : aqi > 100 ? "#ff9e4f" : aqi > 50 ? "#ffc35c" : "#6ce7a5";
    elements["aqi-value"].style.color = color;
    elements["aqi-banner"].style.borderColor = `${color}55`;
    elements["aqi-banner"].style.background = `linear-gradient(90deg, ${color}1f, ${color}08)`;
}

function calculateApparentTemperature(temperatureC, humidityPct, windSpeedMs) {
    const vapourPressure = (humidityPct / 100) * 6.105 * Math.exp((17.27 * temperatureC) / (237.7 + temperatureC));
    const apparent = temperatureC + 0.33 * vapourPressure - 0.7 * windSpeedMs - 4.0;
    return Math.max(-20, Math.min(65, apparent));
}

function thermalStatusForValue(value) {
    if (value >= 82) return { label: "EXTREME", className: "extreme", color: "#ff5d66" };
    if (value >= 62) return { label: "HIGH", className: "high", color: "#ff874f" };
    if (value >= 38) return { label: "ELEVATED", className: "elevated", color: "#ffc35c" };
    return { label: "MODERATE", className: "moderate", color: "#6ce7a5" };
}

function ambientHeatLabel(value) {
    if (value >= 82) return "Extreme surface heating";
    if (value >= 62) return "High thermal load";
    if (value >= 38) return "Elevated heat";
    return "Moderate heat";
}

function setThermalCore(value, color) {
    const core = elements["thermal-core"];
    if (!core) return;
    core.style.setProperty("--thermal-value", Math.max(0, Math.min(100, value)));
    core.style.setProperty("--thermal-color", color);
}

function setVerticalMeter(id, value) {
    const element = elements[id];
    if (element) element.style.height = `${Math.max(3, Math.min(100, value))}%`;
}

function formatGombeTimestamp(value) {
    const date = value ? new Date(value) : new Date();
    const time = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "Africa/Lagos",
    }).format(date);
    return `${time} UTC+1`;
}

function formatDelta(delta) {
    if (Math.abs(delta) < 0.05) return "Stable this second";
    return `${delta > 0 ? "▲" : "▼"} ${Math.abs(delta).toFixed(1)} µg/m³ this second`;
}

function guidanceForAqi(aqi) {
    if (aqi <= 50) return "Outdoor activity is generally suitable";
    if (aqi <= 100) return "Sensitive people should monitor symptoms";
    if (aqi <= 150) return "Reduce prolonged outdoor exertion";
    if (aqi <= 200) return "Limit outdoor exposure and use protection";
    return "Avoid outdoor exposure where possible";
}

function humidityState(humidity) {
    if (humidity < 20) return "Extremely dry";
    if (humidity < 35) return "Very dry";
    if (humidity < 55) return "Dry";
    if (humidity < 75) return "Humid";
    return "Very humid";
}

function calculateDewPoint(temperatureC, humidityPct) {
    const safeHumidity = Math.max(1, Math.min(100, humidityPct));
    const a = 17.625;
    const b = 243.04;
    const gamma = Math.log(safeHumidity / 100) + (a * temperatureC) / (b + temperatureC);
    return (b * gamma) / (a - gamma);
}

function weatherSymbol(weather) {
    const condition = String(weather.condition || "").toLowerCase();
    if (Number(weather.precipitation_mm_1h || 0) > 0.05 || condition.includes("rain")) return "☂";
    if (condition.includes("storm") || condition.includes("thunder")) return "ϟ";
    if (condition.includes("dust") || condition.includes("haze") || condition.includes("sand")) return "≋";
    if (Number(weather.cloud_cover_pct || 0) > 70) return "☁";
    if (Number(weather.cloud_cover_pct || 0) > 30) return "◒";
    return "☀";
}

function beaufortDescription(speed) {
    if (speed < 0.5) return "Calm";
    if (speed < 1.6) return "Light air";
    if (speed < 3.4) return "Light breeze";
    if (speed < 5.5) return "Gentle breeze";
    if (speed < 8.0) return "Moderate breeze";
    if (speed < 10.8) return "Fresh breeze";
    if (speed < 13.9) return "Strong breeze";
    if (speed < 17.2) return "Near gale";
    return "Gale force";
}

function windState(speed) {
    if (speed < 2) return "Weak flow";
    if (speed < 5) return "Steady flow";
    if (speed < 9) return "Active flow";
    if (speed < 13) return "Strong transport";
    return "Severe transport";
}

function observationAge(isoString) {
    const ageSeconds = Math.max(0, Math.round((Date.now() - new Date(isoString).getTime()) / 1000));
    if (ageSeconds < 60) return `${ageSeconds}s OLD`;
    if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)}m OLD`;
    return `${Math.floor(ageSeconds / 3600)}h OLD`;
}

function compassDirection(degrees) {
    const directions = ["N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE", "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW"];
    return directions[Math.round(((degrees % 360) / 22.5)) % 16];
}

function formatTime(isoString) {
    return new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "Africa/Lagos",
    }).format(new Date(isoString));
}

function setMeter(id, value) {
    const element = elements[id];
    if (element) element.style.width = `${Math.max(0, Math.min(100, value))}%`;
}

function setText(id, value) {
    const element = elements[id];
    if (element) element.textContent = value;
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    }[character]));
}

function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add("show");
    window.clearTimeout(showToast.timeoutId);
    showToast.timeoutId = window.setTimeout(() => elements.toast.classList.remove("show"), 2200);
}

function updateClock() {
    elements["live-clock"].textContent = new Intl.DateTimeFormat("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
        timeZone: "Africa/Lagos",
    }).format(new Date());
}
window.setInterval(updateClock, 1000);
updateClock();

let lastMapPulseAt = 0;
function animateMapLayers(now) {
    const pulseInterval = state.platformMode === "mobile" ? 260 : state.platformMode === "tablet" ? 160 : 80;
    if (!document.hidden && state.mapReady && now - lastMapPulseAt >= pulseInterval) {
        lastMapPulseAt = now;
        const pulse = 0.5 + 0.5 * Math.sin(Date.now() / 420);
        if (map.getLayer("fire-glow")) map.setPaintProperty("fire-glow", "circle-opacity", 0.09 + pulse * 0.13);
        if (map.getLayer("fire-heat")) map.setPaintProperty("fire-heat", "heatmap-intensity", state.heatEnabled ? 0.72 + pulse * 0.55 : 0);
        if (map.getLayer("sensor-halo")) map.setPaintProperty("sensor-halo", "circle-opacity", 0.04 + pulse * 0.08);
        if (map.getLayer("wind-lines")) map.setPaintProperty("wind-lines", "line-opacity", state.windEnabled ? 0.16 + pulse * 0.14 : 0);
        if (map.getLayer("wind-arrows")) map.setPaintProperty("wind-arrows", "text-opacity", state.windEnabled ? 0.4 + pulse * 0.28 : 0);
    }
    requestAnimationFrame(animateMapLayers);
}
animateMapLayers();

function autoRotateFrame() {
    if (!document.hidden && state.platformMode === "desktop" && state.autoRotate && !map.isMoving()) {
        map.rotateTo((map.getBearing() + 0.045) % 360, { duration: 0 });
    }
    requestAnimationFrame(autoRotateFrame);
}
autoRotateFrame();

async function toggleMapFullscreen() {
    try {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
            return;
        }
        if (appShell.requestFullscreen) {
            await appShell.requestFullscreen();
            return;
        }
    } catch (error) {
        console.warn("Native fullscreen unavailable", error);
    }
    document.body.classList.toggle("map-fullscreen");
    window.setTimeout(() => {
        map.resize();
        updateSpatialOverlays();
        focusGombeBoundary(300);
    }, 80);
}

document.addEventListener("fullscreenchange", () => {
    document.body.classList.toggle("map-fullscreen", Boolean(document.fullscreenElement));
    window.setTimeout(() => {
        map.resize();
        updateSpatialOverlays();
        focusGombeBoundary(300);
    }, 100);
});

function bindControls() {
    const legend = document.getElementById("map-legend");
    const legendToggle = document.getElementById("legend-toggle");
    legendToggle?.addEventListener("click", () => {
        const expanded = !legend.classList.contains("expanded");
        legend.dataset.userToggled = "true";
        legend.classList.toggle("expanded", expanded);
        legendToggle.setAttribute("aria-expanded", String(expanded));
        const icon = legendToggle.querySelector("b");
        if (icon) icon.textContent = expanded ? "−" : "+";
    });

    document.getElementById("lga-card-close")?.addEventListener("click", closeLgaCard);
    document.getElementById("mobile-zoom-in")?.addEventListener("click", () => map.zoomIn({ duration: 250 }));
    document.getElementById("mobile-zoom-out")?.addEventListener("click", () => map.zoomOut({ duration: 250 }));
    document.getElementById("mobile-reset-view")?.addEventListener("click", () => focusGombeBoundary(450));
    document.getElementById("mobile-fullscreen")?.addEventListener("click", toggleMapFullscreen);

    document.getElementById("reset-view").addEventListener("click", () => {
        focusGombeBoundary(1500);
    });

    document.getElementById("toggle-particles").addEventListener("click", (event) => {
        state.particlesEnabled = !state.particlesEnabled;
        event.currentTarget.classList.toggle("active", state.particlesEnabled);
        dustField.setEnabled(state.particlesEnabled);
        if (state.mapReady && map.getLayer("dust-heat")) {
            map.setLayoutProperty("dust-heat", "visibility", state.particlesEnabled ? "visible" : "none");
        }
        showToast(`Dust particles ${state.particlesEnabled ? "enabled" : "paused"}`);
    });

    document.getElementById("toggle-wind").addEventListener("click", (event) => {
        state.windEnabled = !state.windEnabled;
        event.currentTarget.classList.toggle("active", state.windEnabled);
        windField.setEnabled(state.windEnabled);
        showToast(`Wind streamlines ${state.windEnabled ? "enabled" : "paused"}`);
    });

    document.getElementById("toggle-heat").addEventListener("click", (event) => {
        state.heatEnabled = !state.heatEnabled;
        event.currentTarget.classList.toggle("active", state.heatEnabled);
        heatField.setEnabled(state.heatEnabled);
        if (state.mapReady) {
            for (const layerId of ["fire-heat", "fire-glow"]) {
                if (map.getLayer(layerId)) {
                    map.setLayoutProperty(layerId, "visibility", state.heatEnabled ? "visible" : "none");
                }
            }
        }
        showToast(`Heat haze and thermal layer ${state.heatEnabled ? "enabled" : "paused"}`);
    });

    document.getElementById("toggle-radar").addEventListener("click", (event) => {
        state.radarEnabled = !state.radarEnabled;
        event.currentTarget.classList.toggle("active", state.radarEnabled);
        state.radarMarkers.forEach((marker) => {
            marker.getElement().style.display = state.radarEnabled ? "block" : "none";
        });
        showToast(`Radar network ${state.radarEnabled ? "visible" : "hidden"}`);
    });

    document.getElementById("toggle-boost").addEventListener("click", (event) => {
        state.visualBoost = !state.visualBoost;
        event.currentTarget.classList.toggle("active", state.visualBoost);
        appShell.classList.toggle("visual-boost", state.visualBoost);
        dustField.setBoost(state.visualBoost);
        windField.setBoost(state.visualBoost);
        heatField.setBoost(state.visualBoost);
        showToast(`High-visibility sparkle boost ${state.visualBoost ? "enabled" : "reduced"}`);
    });

    document.getElementById("toggle-rotate").addEventListener("click", (event) => {
        if (state.platformMode !== "desktop") {
            showToast("Orbit is disabled on mobile and tablet to preserve smooth performance");
            return;
        }
        state.autoRotate = !state.autoRotate;
        event.currentTarget.classList.toggle("active", state.autoRotate);
        map.easeTo({ pitch: state.autoRotate ? 28 : 0, duration: 650, essential: true });
        if (!state.autoRotate) window.setTimeout(() => focusGombeBoundary(500), 680);
        showToast(`Map orbit ${state.autoRotate ? "enabled" : "disabled"}`);
    });
}

function updateAnimationHud() {
    const dustStats = dustField.getStats();
    const windStats = windField.getStats();
    const heatStats = heatField.getStats();
    const fpsValues = [dustStats.fps, windStats.fps, heatStats.fps].filter((value) => Number.isFinite(value));
    const fps = fpsValues.length ? Math.round(fpsValues.reduce((sum, value) => sum + value, 0) / fpsValues.length) : 0;
    setText("animation-fps", `${fps} FPS`);
    setText("visible-sparks", dustStats.visibleCount.toLocaleString());
    setText("visible-wind", windStats.visibleCount.toLocaleString());
    setText("active-flashes", dustStats.burstCount.toLocaleString());
    setText("sparkle-severity", `${Math.round(dustStats.severity)}%`);
    setText("spark-count", dustStats.radiantCount.toLocaleString());
    setText("motion-status", state.particlesEnabled || state.windEnabled || state.heatEnabled ? "LIVE MOTION" : "PAUSED");
    const hud = document.getElementById("live-motion-hud");
    if (hud) hud.classList.toggle("motion-paused", !(state.particlesEnabled || state.windEnabled || state.heatEnabled));
}

window.setInterval(updateAnimationHud, state.platformMode === "mobile" ? 750 : 350);
updateAnimationHud();

bindControls();
connectSocket();
