import { connectLive, formatDateTime, initialisePortal, setText } from "./portal.js?v=10.1.0";
initialisePortal();
function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
}
const state = { insight: null, topic: "particles" };
async function loadRegions() {
    const response = await fetch("/api/regions", { cache: "no-store" });
    const data = await response.json();
    const select = document.getElementById("evidence-region");
    for (const name of data.regions || []) {
        const option = document.createElement("option"); option.value = name; option.textContent = name; select.append(option);
    }
}
async function loadInsight(name) {
    if (!name) return;
    document.getElementById("evidence-details").innerHTML = '<div class="evidence-card loading-shimmer"><p>Loading evidence from the current frame…</p></div>';
    const response = await fetch(`/api/regions/insight?name=${encodeURIComponent(name)}`, { cache: "no-store" });
    if (!response.ok) throw new Error(await response.text());
    state.insight = await response.json();
    render();
}
function render() {
    const insight = state.insight; if (!insight) return;
    const air = insight.local_air_quality;
    setText("evidence-title", `${insight.region}: ${state.topic[0].toUpperCase()}${state.topic.slice(1)} evidence`);
    setText("evidence-topic-label", state.topic.toUpperCase());
    setText("evidence-confidence", `${air.confidence.toUpperCase()} CONFIDENCE`);
    setText("evidence-provenance", insight.evidence_notice || "Source provenance is unavailable.");
    document.getElementById("evidence-provenance").dataset.mode = insight.evidence_mode || "unknown";
    setText("evidence-aqi", air.aqi); setText("evidence-category", air.category);
    setText("evidence-pm25", air.pm25.toFixed(1)); setText("evidence-pm10", air.pm10.toFixed(1));
    setText("evidence-method-short", air.station_count ? `${air.station_count} station inputs` : "State aggregate");
    setText("evidence-nearest", air.nearest_station_km == null ? air.method : `Nearest station ${air.nearest_station_km.toFixed(1)} km`);
    setText("evidence-health", insight.health_recommendation);
    const details = insight.explanations?.[state.topic] || [];
    document.getElementById("evidence-details").innerHTML = details.map((item) => `<article class="evidence-card"><header><small>${escapeHtml(item.label)}</small><strong>${escapeHtml(item.value)}</strong></header><p>${escapeHtml(item.interpretation)}</p><footer>Source: ${escapeHtml(item.source)}</footer></article>`).join("");
    document.getElementById("evidence-caveats").innerHTML = (insight.caveats || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
}
document.getElementById("evidence-region").addEventListener("change", (event) => loadInsight(event.target.value).catch((error) => {
    document.getElementById("evidence-details").innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
}));
document.querySelectorAll(".topic-card").forEach((card) => card.addEventListener("click", () => {
    document.querySelectorAll(".topic-card").forEach((item) => item.classList.remove("active"));
    card.classList.add("active"); state.topic = card.dataset.topic; render();
}));
connectLive((frame) => setText("evidence-frame", `${String(frame.sequence).padStart(6,"0")} · ${formatDateTime(frame.generated_at)}`), (status) => setText("portal-stream", status.toUpperCase()));
loadRegions();
