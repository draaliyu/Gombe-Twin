import { aqiStyle, connectLive, formatDateTime, initialisePortal, setText } from "./portal.js?v=10.1.0";

initialisePortal();
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
}
const state = { frame: null, lgas: [], selected: null, insight: null, topic: "particles", bounds: null };
const map = new maplibregl.Map({
    container: "explorer-map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: [11.24, 10.43], zoom: 7.55, pitch: 0, bearing: 0,
    cooperativeGestures: true, renderWorldCopies: false, attributionControl: false, fadeDuration: 0,
});

function featureName(feature) {
    const p = feature?.properties || {};
    return String(p.lga_name || p.shapeName || p.shape_name || p.name || "Local Government Area");
}
function allCoordinates(geometry) {
    if (!geometry) return [];
    if (geometry.type === "Point") return [geometry.coordinates];
    if (geometry.type === "Polygon") return geometry.coordinates.flat();
    if (geometry.type === "MultiPolygon") return geometry.coordinates.flat(2);
    return [];
}
function fitCollection(collection, duration = 0) {
    const coordinates = (collection.features || []).flatMap((feature) => allCoordinates(feature.geometry));
    if (!coordinates.length) return;
    const bounds = coordinates.reduce((box, coordinate) => box.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
    state.bounds = bounds;
    map.fitBounds(bounds, { padding: window.innerWidth < 640 ? 28 : 54, duration, maxZoom: 9 });
}
function aqiExpression(aqi = state.frame?.air_quality?.aqi || 0) {
    const style = aqiStyle(aqi);
    return style.colour;
}
async function loadMapData() {
    const [boundaryResponse, lgaResponse] = await Promise.all([fetch("/api/boundary"), fetch("/api/lgas")]);
    const boundary = await boundaryResponse.json();
    const lgas = await lgaResponse.json();
    state.lgas = lgas.features || [];
    populateSelect();
    map.addSource("gombe-state", { type: "geojson", data: boundary });
    map.addLayer({ id: "state-fill", type: "fill", source: "gombe-state", paint: { "fill-color": "#071b24", "fill-opacity": .45 } });
    map.addLayer({ id: "state-line", type: "line", source: "gombe-state", paint: { "line-color": "#aefdf3", "line-width": 2.4, "line-opacity": .92 } });
    map.addSource("gombe-lgas", { type: "geojson", data: lgas, generateId: true });
    map.addLayer({ id: "lga-fill", type: "fill", source: "gombe-lgas", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": aqiExpression(), "fill-opacity": .13 } });
    map.addLayer({ id: "lga-line", type: "line", source: "gombe-lgas", filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": "#8de8df", "line-width": 1.15, "line-opacity": .7 } });
    map.addLayer({ id: "lga-points", type: "circle", source: "gombe-lgas", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 8, "circle-color": aqiExpression(), "circle-stroke-color": "#fff", "circle-stroke-width": 1.5 } });
    map.addLayer({ id: "selected-line", type: "line", source: "gombe-lgas", filter: ["==", ["get", "lga_name"], "__none__"], paint: { "line-color": "#fff", "line-width": 3.5 } });
    ["lga-fill", "lga-points"].forEach((layer) => {
        map.on("mouseenter", layer, () => { map.getCanvas().style.cursor = "pointer"; });
        map.on("mouseleave", layer, () => { map.getCanvas().style.cursor = ""; });
        map.on("click", layer, (event) => selectRegion(featureName(event.features?.[0])));
    });
    fitCollection(boundary);
    setText("explorer-map-status", `${state.lgas.length} Gombe LGAs loaded`);
}
function populateSelect() {
    const select = document.getElementById("region-select");
    const names = state.lgas.map(featureName).sort((a, b) => a.localeCompare(b));
    for (const name of names) {
        const option = document.createElement("option"); option.value = name; option.textContent = name; select.append(option);
    }
}
async function selectRegion(name) {
    if (!name) return;
    state.selected = name;
    document.getElementById("region-select").value = name;
    setText("region-name", name); setText("region-category", "Loading evidence…");
    document.getElementById("region-evidence").innerHTML = '<div class="evidence-card loading-shimmer"><p>Loading current API evidence…</p></div>';
    try {
        const response = await fetch(`/api/regions/insight?name=${encodeURIComponent(name)}`, { cache: "no-store" });
        if (!response.ok) throw new Error(await response.text());
        state.insight = await response.json();
        renderInsight();
        if (map.getLayer("selected-line")) map.setFilter("selected-line", ["==", ["get", "lga_name"], name]);
    } catch (error) {
        setText("region-category", "Unable to load region");
        document.getElementById("region-evidence").innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
    }
}
function renderInsight() {
    const insight = state.insight; if (!insight) return;
    const air = insight.local_air_quality;
    const style = aqiStyle(air.aqi);
    document.getElementById("region-hero").style.setProperty("--region-colour", style.colour);
    setText("region-aqi", air.aqi); setText("region-category", air.category); setText("region-method", air.method);
    setText("region-pm25", `${air.pm25.toFixed(1)} µg/m³`); setText("region-pm10", `${air.pm10.toFixed(1)} µg/m³`);
    setText("region-nearest", air.nearest_station_km == null ? "State aggregate" : `${air.nearest_station_km.toFixed(1)} km`);
    setText("region-hotspots", insight.thermal.nearby_hotspot_count);
    setText("region-confidence", `${air.confidence.toUpperCase()} CONFIDENCE`);
    setText("region-provenance", insight.evidence_notice || "Source provenance is unavailable.");
    document.getElementById("region-provenance").dataset.mode = insight.evidence_mode || "unknown";
    setText("region-health", insight.health_recommendation);
    setText("region-updated", `Updated ${formatDateTime(insight.generated_at)} · ${insight.sources.air_quality}`);
    renderEvidence();
}
function renderEvidence() {
    const container = document.getElementById("region-evidence");
    const rows = state.insight?.explanations?.[state.topic] || [];
    container.innerHTML = rows.map((item) => `<article class="evidence-card"><header><small>${escapeHtml(item.label)}</small><strong>${escapeHtml(item.value)}</strong></header><p>${escapeHtml(item.interpretation)}</p><footer>Source: ${escapeHtml(item.source)}</footer></article>`).join("") || '<div class="notice">No evidence is available for this topic.</div>';
}
document.querySelectorAll(".insight-tabs button").forEach((button) => button.addEventListener("click", () => {
    document.querySelectorAll(".insight-tabs button").forEach((item) => item.classList.remove("active"));
    button.classList.add("active"); state.topic = button.dataset.topic; renderEvidence();
}));
document.getElementById("region-select").addEventListener("change", (event) => selectRegion(event.target.value));
document.getElementById("explorer-zoom-in").addEventListener("click", () => map.zoomIn());
document.getElementById("explorer-zoom-out").addEventListener("click", () => map.zoomOut());
document.getElementById("explorer-reset").addEventListener("click", () => state.bounds && map.fitBounds(state.bounds, { padding: window.innerWidth < 640 ? 28 : 54, duration: 450, maxZoom: 9 }));
map.on("load", loadMapData);
connectLive((frame) => {
    state.frame = frame;
    const colour = aqiExpression(frame.air_quality?.aqi);
    if (map.getLayer("lga-fill")) map.setPaintProperty("lga-fill", "fill-color", colour);
    if (map.getLayer("lga-points")) map.setPaintProperty("lga-points", "circle-color", colour);
}, (status) => setText("portal-stream", status.toUpperCase()));
