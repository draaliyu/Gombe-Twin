export function formatGombeTime(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Lagos",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
    }).format(date);
}

export function formatDateTime(value) {
    if (!value) return "Unavailable";
    return new Intl.DateTimeFormat("en-GB", {
        timeZone: "Africa/Lagos",
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(new Date(value));
}

export function compassDirection(degrees = 0) {
    const labels = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
    return labels[Math.round((((Number(degrees) % 360) + 360) % 360) / 45) % 8];
}

export function aqiStyle(aqi = 0) {
    const value = Number(aqi) || 0;
    if (value <= 50) return { colour: "#43d17c", category: "Good" };
    if (value <= 100) return { colour: "#f0d34f", category: "Moderate" };
    if (value <= 150) return { colour: "#ff963f", category: "Unhealthy for sensitive groups" };
    if (value <= 200) return { colour: "#ef4f58", category: "Unhealthy" };
    return { colour: "#8c4ab8", category: "Very unhealthy" };
}

export function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value;
}

class PortalAtmosphere {
    constructor(host) {
        this.host = host;
        this.canvas = document.createElement("canvas");
        this.canvas.className = "portal-atmosphere-canvas";
        this.canvas.setAttribute("aria-hidden", "true");
        host.prepend(this.canvas);
        this.context = this.canvas.getContext("2d", { alpha: true });
        this.frame = null;
        this.width = 1;
        this.height = 1;
        this.lastTime = 0;
        this.hidden = false;
        this.mobile = window.matchMedia("(max-width: 720px)").matches;
        this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        this.targetInterval = 1000 / (this.reducedMotion ? 8 : this.mobile ? 18 : 28);
        this.windParticles = [];
        this.clouds = [];
        this.rainDrops = [];
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(host);
        this.resize();
        this.seed();
        this.onVisibility = () => { this.hidden = document.hidden; };
        document.addEventListener("visibilitychange", this.onVisibility);
        window.addEventListener("gombe:live-frame", (event) => this.update(event.detail));
        requestAnimationFrame((time) => this.animate(time));
    }

    resize() {
        const rect = this.host.getBoundingClientRect();
        this.width = Math.max(1, rect.width);
        this.height = Math.max(1, rect.height);
        const dpr = Math.min(window.devicePixelRatio || 1, this.mobile ? 1 : 1.35);
        this.canvas.width = Math.round(this.width * dpr);
        this.canvas.height = Math.round(this.height * dpr);
        this.canvas.style.width = `${this.width}px`;
        this.canvas.style.height = `${this.height}px`;
        this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    seed() {
        const windCount = this.mobile ? 18 : 34;
        const cloudCount = this.mobile ? 5 : 8;
        const rainCount = this.mobile ? 42 : 90;
        this.windParticles = Array.from({ length: windCount }, () => ({
            x: Math.random(), y: Math.random(), phase: Math.random() * Math.PI * 2,
            speed: 0.45 + Math.random() * 0.8, length: 18 + Math.random() * 34,
        }));
        this.clouds = Array.from({ length: cloudCount }, () => ({
            x: Math.random(), y: 0.08 + Math.random() * 0.55, size: 45 + Math.random() * 85,
            speed: 0.08 + Math.random() * 0.18, opacity: 0.08 + Math.random() * 0.12,
        }));
        this.rainDrops = Array.from({ length: rainCount }, () => ({
            x: Math.random(), y: Math.random(), speed: 0.45 + Math.random() * 0.9,
            length: 8 + Math.random() * 13,
        }));
    }

    update(frame) {
        this.frame = frame;
        const weather = frame?.weather || {};
        const condition = String(weather.condition || "").toLowerCase();
        this.host.dataset.weather = condition.includes("thunder") ? "thunderstorm"
            : condition.includes("rain") || condition.includes("drizzle") ? "rain"
            : condition.includes("cloud") || condition.includes("overcast") ? "clouds"
            : condition.includes("haze") || condition.includes("dust") || condition.includes("mist") ? "haze"
            : "clear";
    }

    drawCloud(cloud, dt, windX, cloudFactor) {
        cloud.x += windX * cloud.speed * dt * 0.000012;
        if (cloud.x > 1.25) cloud.x = -0.25;
        if (cloud.x < -0.25) cloud.x = 1.25;
        const x = cloud.x * this.width;
        const y = cloud.y * this.height;
        const size = cloud.size * (0.65 + cloudFactor * 0.65);
        const context = this.context;
        context.save();
        context.globalAlpha = cloud.opacity * (0.3 + cloudFactor * 1.15);
        context.fillStyle = "rgba(210,236,241,.9)";
        context.filter = `blur(${this.mobile ? 5 : 8}px)`;
        context.beginPath();
        context.ellipse(x, y, size * 0.72, size * 0.27, 0, 0, Math.PI * 2);
        context.ellipse(x - size * 0.24, y - size * 0.11, size * 0.34, size * 0.27, 0, 0, Math.PI * 2);
        context.ellipse(x + size * 0.16, y - size * 0.13, size * 0.4, size * 0.3, 0, 0, Math.PI * 2);
        context.fill();
        context.restore();
    }

    draw(time, dt) {
        const context = this.context;
        context.clearRect(0, 0, this.width, this.height);
        const weather = this.frame?.weather || {};
        const windSpeed = Math.max(0.4, Number(weather.wind_speed_ms) || 2.5);
        const degrees = Number(weather.wind_direction_deg) || 45;
        const transportRadians = ((degrees + 180) * Math.PI) / 180;
        const windX = Math.sin(transportRadians);
        const windY = -Math.cos(transportRadians);
        const cloudFactor = Math.max(0.08, Math.min(1, (Number(weather.cloud_cover_pct) || 18) / 100));
        const rainValue = Math.max(0, Number(weather.precipitation_mm_1h) || 0);
        const condition = String(weather.condition || "").toLowerCase();
        const rainFactor = Math.min(1, rainValue / 4 + (condition.includes("rain") || condition.includes("drizzle") ? 0.3 : 0));

        for (const cloud of this.clouds) this.drawCloud(cloud, dt, windX * windSpeed, cloudFactor);

        context.save();
        context.lineCap = "round";
        for (const particle of this.windParticles) {
            const velocity = (0.000025 + windSpeed * 0.0000075) * particle.speed * dt;
            particle.x += windX * velocity;
            particle.y += windY * velocity;
            if (particle.x > 1.1) particle.x = -0.1;
            if (particle.x < -0.1) particle.x = 1.1;
            if (particle.y > 1.1) particle.y = -0.1;
            if (particle.y < -0.1) particle.y = 1.1;
            const x = particle.x * this.width;
            const y = particle.y * this.height;
            const pulse = 0.35 + 0.35 * Math.sin(time * 0.002 + particle.phase);
            const length = particle.length * (0.55 + Math.min(windSpeed, 12) / 12);
            const gradient = context.createLinearGradient(x - windX * length, y - windY * length, x, y);
            gradient.addColorStop(0, "rgba(67,215,210,0)");
            gradient.addColorStop(1, `rgba(112,239,232,${0.18 + pulse * 0.32})`);
            context.strokeStyle = gradient;
            context.lineWidth = this.mobile ? 1 : 1.25;
            context.beginPath();
            context.moveTo(x - windX * length, y - windY * length);
            context.quadraticCurveTo(x - windX * length * 0.48 + Math.sin(particle.phase + time * 0.001) * 4, y - windY * length * 0.48, x, y);
            context.stroke();
        }
        context.restore();

        if (rainFactor > 0.02) {
            context.save();
            context.strokeStyle = `rgba(104,184,255,${0.12 + rainFactor * 0.35})`;
            context.lineWidth = this.mobile ? 0.8 : 1;
            const active = Math.max(5, Math.round(this.rainDrops.length * rainFactor));
            for (let index = 0; index < active; index += 1) {
                const drop = this.rainDrops[index];
                drop.x += (windX * 0.00012 + 0.00004) * dt * drop.speed;
                drop.y += 0.00065 * dt * drop.speed;
                if (drop.y > 1.12 || drop.x > 1.12 || drop.x < -0.12) {
                    drop.y = -0.08;
                    drop.x = Math.random();
                }
                const x = drop.x * this.width;
                const y = drop.y * this.height;
                context.beginPath();
                context.moveTo(x, y);
                context.lineTo(x - windX * drop.length * 0.35, y - drop.length);
                context.stroke();
            }
            context.restore();
        }

        if (condition.includes("thunder") && Math.sin(time * 0.0027) > 0.993) {
            context.fillStyle = "rgba(230,248,255,.34)";
            context.fillRect(0, 0, this.width, this.height);
        }
    }

    animate(time) {
        const elapsed = time - this.lastTime;
        if (!this.hidden && elapsed >= this.targetInterval) {
            this.draw(time, Math.min(elapsed || this.targetInterval, 80));
            this.lastTime = time;
        }
        requestAnimationFrame((next) => this.animate(next));
    }
}

export function connectLive(onFrame, onStatus = () => {}) {
    let socket;
    let stopped = false;
    let retry = 0;
    let heartbeat;
    const connect = () => {
        if (stopped) return;
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        socket = new WebSocket(`${protocol}://${window.location.host}/ws/live`);
        onStatus("connecting");
        socket.addEventListener("open", () => {
            retry = 0;
            onStatus("live");
            heartbeat = window.setInterval(() => {
                if (socket.readyState === WebSocket.OPEN) socket.send("ping");
            }, 25000);
        });
        socket.addEventListener("message", (event) => {
            try {
                const frame = JSON.parse(event.data);
                window.dispatchEvent(new CustomEvent("gombe:live-frame", { detail: frame }));
                onFrame(frame);
            } catch (error) {
                console.warn("Invalid telemetry frame", error);
            }
        });
        socket.addEventListener("close", () => {
            window.clearInterval(heartbeat);
            onStatus("offline");
            if (!stopped) {
                retry += 1;
                window.setTimeout(connect, Math.min(30000, 1000 * (2 ** Math.min(retry, 5))));
            }
        });
        socket.addEventListener("error", () => socket.close());
    };
    connect();
    return () => {
        stopped = true;
        window.clearInterval(heartbeat);
        socket?.close();
    };
}

export function initialisePortal() {
    const path = window.location.pathname.replace(/\/$/, "") || "/";
    for (const link of document.querySelectorAll(".service-navigation a")) {
        const href = new URL(link.href).pathname.replace(/\/$/, "") || "/";
        link.classList.toggle("active", href === path);
    }
    const clock = document.getElementById("portal-clock");
    const tick = () => { if (clock) clock.textContent = `${formatGombeTime()} UTC+1`; };
    tick();
    window.setInterval(tick, 1000);
    if (!document.body.classList.contains("weather-service-page") && !document.body.classList.contains("heat-service-page")) {
        let shell = document.querySelector(".portal-atmosphere-shell");
        if (!shell) {
            shell = document.createElement("div");
            shell.className = "portal-atmosphere-shell";
            shell.setAttribute("aria-hidden", "true");
            document.body.prepend(shell);
        }
        if (!shell.querySelector(".portal-atmosphere-canvas")) new PortalAtmosphere(shell);
    }
}

export function renderServiceNavigation() {
    return `
        <a href="/"><b>◉</b>Live Twin</a>
        <a href="/explore"><b>⌖</b>Regional Explorer</a>
        <a href="/weather"><b>≋</b>Weather Dynamics</a>
        <a href="/heat"><b>♨</b>Heat Intelligence</a>
        <a href="/learn"><b>?</b>Evidence Lab</a>
        <a href="/predictions"><b>⌁</b>AI Forecast</a>
    `;
}
