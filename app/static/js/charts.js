function fitCanvas(canvas) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, width: rect.width, height: rect.height };
}

function drawGrid(ctx, width, height) {
    ctx.strokeStyle = "rgba(151, 205, 219, 0.08)";
    ctx.lineWidth = 1;
    for (let y = 0; y <= 4; y += 1) {
        const position = 8 + (height - 16) * y / 4;
        ctx.beginPath();
        ctx.moveTo(0, position);
        ctx.lineTo(width, position);
        ctx.stroke();
    }
    for (let x = 0; x <= 6; x += 1) {
        const position = width * x / 6;
        ctx.beginPath();
        ctx.moveTo(position, 0);
        ctx.lineTo(position, height);
        ctx.stroke();
    }
}

function drawSeries(ctx, values, width, height, minValue, maxValue, stroke, fill) {
    if (values.length < 2) return;
    const padding = 7;
    const usableHeight = height - padding * 2;
    const points = values.map((value, index) => ({
        x: width * index / Math.max(1, values.length - 1),
        y: padding + usableHeight * (1 - (value - minValue) / Math.max(1, maxValue - minValue)),
    }));

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let index = 1; index < points.length; index += 1) {
        const previous = points[index - 1];
        const current = points[index];
        const midpoint = (previous.x + current.x) / 2;
        ctx.bezierCurveTo(midpoint, previous.y, midpoint, current.y, current.x, current.y);
    }
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = stroke;
    ctx.shadowColor = stroke;
    ctx.shadowBlur = 7;
    ctx.stroke();
    ctx.shadowBlur = 0;

    if (fill) {
        ctx.lineTo(points[points.length - 1].x, height);
        ctx.lineTo(points[0].x, height);
        ctx.closePath();
        const gradient = ctx.createLinearGradient(0, 0, 0, height);
        gradient.addColorStop(0, fill);
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = gradient;
        ctx.fill();
    }
}

export class LiveCharts {
    constructor(particleCanvas, windCanvas) {
        this.particleCanvas = particleCanvas;
        this.windCanvas = windCanvas;
        this.pm25 = [];
        this.pm10 = [];
        this.wind = [];
        this.dispersion = [];
        window.addEventListener("resize", () => this.draw());
    }

    push(frame) {
        this.pm25.push(frame.air_quality.pm25);
        this.pm10.push(frame.air_quality.pm10);
        this.wind.push(frame.weather.wind_speed_ms);
        this.dispersion.push(frame.derived.dispersion_score / 10);
        [this.pm25, this.pm10, this.wind, this.dispersion].forEach((series) => {
            if (series.length > 60) series.shift();
        });
        this.draw();
    }

    draw() {
        this.drawParticleChart();
        this.drawWindChart();
    }

    drawParticleChart() {
        const { ctx, width, height } = fitCanvas(this.particleCanvas);
        ctx.clearRect(0, 0, width, height);
        drawGrid(ctx, width, height);
        const combined = [...this.pm25, ...this.pm10];
        const maximum = Math.max(100, ...combined) * 1.12;
        drawSeries(ctx, this.pm10, width, height, 0, maximum, "rgba(255,195,92,0.92)", "rgba(255,195,92,0.08)");
        drawSeries(ctx, this.pm25, width, height, 0, maximum, "rgba(255,133,72,0.98)", "rgba(255,133,72,0.12)");
    }

    drawWindChart() {
        const { ctx, width, height } = fitCanvas(this.windCanvas);
        ctx.clearRect(0, 0, width, height);
        drawGrid(ctx, width, height);
        const maximum = Math.max(15, ...this.wind, ...this.dispersion) * 1.15;
        drawSeries(ctx, this.wind, width, height, 0, maximum, "rgba(67,215,210,0.95)", "rgba(67,215,210,0.11)");
        drawSeries(ctx, this.dispersion, width, height, 0, maximum, "rgba(139,246,235,0.55)", null);
    }
}
