import { connectLive, formatDateTime, initialisePortal, setText } from "./portal.js?v=10.1.0";
initialisePortal();
const canvas = document.getElementById("prediction-chart");
let forecastData = null;
function drawSeries(context, points, colour, xFor, yFor) {
    if (!points.length) return;
    context.beginPath(); context.strokeStyle = colour; context.lineWidth = 2.2; context.lineJoin = "round"; context.lineCap = "round";
    points.forEach((point, index) => { const x = xFor(index); const y = yFor(point.value); index ? context.lineTo(x,y) : context.moveTo(x,y); }); context.stroke();
    context.fillStyle = colour; points.forEach((point, index) => { context.beginPath(); context.arc(xFor(index), yFor(point.value), 3.2, 0, Math.PI*2); context.fill(); });
}
function drawChart() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5); const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(rect.width*dpr)); canvas.height = Math.max(1, Math.round(rect.height*dpr));
    const ctx = canvas.getContext("2d"); ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,rect.width,rect.height);
    const provider = forecastData?.provider_forecast || []; const ai = forecastData?.ai_forecast?.forecast || []; const count = Math.max(provider.length, ai.length, 2);
    const values = [...provider.flatMap((p) => [p.pm25,p.pm10]), ...ai.flatMap((p) => [p.pm25,p.pm10])].map(Number).filter(Number.isFinite);
    const maximum = Math.max(50, ...values) * 1.12; const left=42,right=18,top=18,bottom=32; const width=rect.width-left-right; const height=rect.height-top-bottom;
    ctx.strokeStyle="rgba(255,255,255,.08)"; ctx.fillStyle="#6f878e"; ctx.font="9px system-ui"; ctx.textAlign="right";
    for(let i=0;i<=4;i++){ const value=maximum*(1-i/4); const y=top+height*i/4; ctx.beginPath();ctx.moveTo(left,y);ctx.lineTo(rect.width-right,y);ctx.stroke();ctx.fillText(value.toFixed(0),left-7,y+3); }
    const xFor=(index)=>left+(count===1?0:width*index/(count-1)); const yFor=(value)=>top+height-(Number(value)/maximum)*height;
    drawSeries(ctx, provider.map((p)=>({value:p.pm25})), "#43d7d2", xFor, yFor); drawSeries(ctx, provider.map((p)=>({value:p.pm10})), "#f4ca64", xFor, yFor);
    drawSeries(ctx, ai.map((p)=>({value:p.pm25})), "#ff914d", xFor, yFor); drawSeries(ctx, ai.map((p)=>({value:p.pm10})), "#ef4f58", xFor, yFor);
}
async function loadStatus() {
    const response = await fetch("/api/predictions/status", { cache:"no-store" }); const status = await response.json();
    setText("prediction-ready", status.ready ? "READY" : "NOT TRAINED"); setText("prediction-samples", status.eligible_samples); setText("prediction-samples-note", `${status.samples_needed} more required`);
    setText("prediction-trained", status.ready ? "YES" : "NO"); setText("prediction-trained-at", status.model?.trained_at ? formatDateTime(status.model.trained_at) : "Administrator training required");
    setText("model-algorithm", status.model?.algorithm || "Not trained"); setText("model-sample-count", status.model?.sample_count || 0);
    setText("model-pm25-mae", status.model?.pm25_validation ? `${status.model.pm25_validation.mae} µg/m³` : "--"); setText("model-pm10-mae", status.model?.pm10_validation ? `${status.model.pm10_validation.mae} µg/m³` : "--");
    const ratio = Math.min(100, 100 * status.eligible_samples / Math.max(status.minimum_samples,1)); document.getElementById("sample-progress").style.setProperty("--progress", `${ratio}%`);
    setText("model-readiness-note", status.ready ? `Trained from ${status.model.sample_count} eligible live API rows.` : `${status.eligible_samples}/${status.minimum_samples} eligible live paired observations collected.`);
    setText("admin-state", status.admin_retraining_enabled ? "ENABLED" : "DISABLED");
}
async function loadForecast() {
    const hours = document.getElementById("prediction-horizon").value;
    const response = await fetch(`/api/predictions/forecast?hours=${hours}`, { cache:"no-store" }); forecastData = await response.json();
    setText("prediction-current-aqi", forecastData.current?.aqi ?? "--"); setText("prediction-current-category", forecastData.current?.category || "Awaiting");
    const providerCount = forecastData.provider_forecast?.length || 0; const aiReady = Boolean(forecastData.ai_forecast?.ready);
    setText("prediction-message", `${providerCount ? `${providerCount} provider forecast points loaded.` : "No provider forecast points are available."} ${aiReady ? "The local AI forecast is overlaid with uncertainty-aware model output." : forecastData.ai_forecast?.message || "The local model is not ready."}`);
    drawChart();
}
async function retrain() {
    const button = document.getElementById("admin-retrain"); const password = document.getElementById("admin-password").value;
    if (!password) { setText("admin-result", "Enter the administrator password."); return; }
    button.disabled=true; setText("admin-result", "Retraining from eligible live observations…");
    try {
        const response = await fetch("/api/admin/model/retrain", { method:"POST", headers:{ Authorization:`Bearer ${password}` } });
        const result = await response.json(); if (!response.ok) throw new Error(result.detail || result.message || `Request failed (${response.status})`);
        setText("admin-result", `${result.message} Trained ${result.metadata.sample_count} samples.`); document.getElementById("admin-password").value=""; await loadStatus(); await loadForecast();
    } catch(error) { setText("admin-result", error.message); } finally {
        document.getElementById("admin-password").value = "";
        button.disabled=false;
    }
}
document.getElementById("prediction-horizon").addEventListener("change", loadForecast); document.getElementById("admin-retrain").addEventListener("click", retrain); window.addEventListener("resize", drawChart, {passive:true});
connectLive((frame)=>{ setText("prediction-current-aqi", frame.air_quality?.aqi ?? "--"); setText("prediction-current-category", frame.air_quality?.category || "Awaiting"); }, (status)=>setText("portal-stream",status.toUpperCase()));
Promise.all([loadStatus(),loadForecast()]); window.setInterval(loadForecast, 10*60*1000);
