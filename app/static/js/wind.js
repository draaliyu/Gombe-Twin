const GOMBE_BOUNDS = { west: 10.15, south: 9.45, east: 12.35, north: 11.55 };

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
}

export class WindFlowField {
    constructor(map, canvas) {
        this.map = map;
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
        this.enabled = true;
        this.paused = false;
        this.boosted = true;
        this.windSpeed = 7;
        this.windDirection = 52;
        this.gustSpeed = 10;
        this.humidity = 25;
        this.dispersion = 55;
        this.streams = [];
        this.wavefronts = [];
        this.baseTargetCount = 150;
        this.targetCount = 150;
        this.qualityMode = "desktop";
        this.qualityScale = 1;
        this.minFrameInterval = 0;
        this.lastRenderedAt = 0;
        this.visibleCount = 0;
        this.lastTime = performance.now();
        this.lastWaveSpawn = 0;
        this.fps = 60;
        this.frameCounter = 0;
        this.fpsWindowStarted = performance.now();
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
        this.resize = this.resize.bind(this);
        this.animate = this.animate.bind(this);

        window.addEventListener("resize", this.resize);
        this.map.on("resize", this.resize);
        this.resize();
        this.seedStreams(this.targetCount);
        requestAnimationFrame(this.animate);
    }

    setQuality(mode = "desktop") {
        this.qualityMode = mode;
        const profiles = {
            desktop: { scale: 1, dpr: 1.5, interval: 0 },
            tablet: { scale: 0.62, dpr: 1.15, interval: 22 },
            mobile: { scale: 0.36, dpr: 1, interval: 33 },
        };
        const profile = profiles[mode] || profiles.desktop;
        this.qualityScale = profile.scale;
        this.minFrameInterval = profile.interval;
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, profile.dpr);
        this.targetCount = Math.max(36, Math.round(this.baseTargetCount * this.qualityScale));
        this.reconcileCount();
        this.resize();
    }

    setTelemetry(frame) {
        this.windSpeed = Number(frame.weather?.wind_speed_ms) || 0;
        this.windDirection = Number(frame.weather?.wind_direction_deg) || 0;
        this.gustSpeed = Number(frame.weather?.wind_gust_ms) || this.windSpeed;
        this.humidity = Number(frame.weather?.humidity_pct) || 0;
        this.dispersion = Number(frame.derived?.dispersion_score) || 0;
        this.baseTargetCount = Math.round(110 + Math.min(140, this.windSpeed * 9));
        this.targetCount = Math.max(36, Math.round(this.baseTargetCount * this.qualityScale));
        this.reconcileCount();
    }

    setPaused(paused) {
        this.paused = Boolean(paused);
        if (this.paused) {
            this.lastTime = performance.now();
            this.ctx.clearRect(0, 0, this.canvas.clientWidth, this.canvas.clientHeight);
        }
    }

    setEnabled(enabled) {
        this.enabled = enabled;
        this.canvas.style.opacity = enabled ? "1" : "0";
    }

    setBoost(enabled) {
        this.boosted = enabled;
        this.canvas.classList.toggle("boosted", enabled);
    }

    getStats() {
        return {
            fps: this.fps,
            streamCount: this.streams.length,
            visibleCount: this.visibleCount,
            waveCount: this.wavefronts.length,
        };
    }

    resize() {
        const rect = this.map.getContainer().getBoundingClientRect();
        this.canvas.width = Math.max(1, Math.round(rect.width * this.pixelRatio));
        this.canvas.height = Math.max(1, Math.round(rect.height * this.pixelRatio));
        this.canvas.style.width = `${rect.width}px`;
        this.canvas.style.height = `${rect.height}px`;
        this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
    }

    seedStreams(count) {
        for (let index = 0; index < count; index += 1) {
            this.streams.push(this.createStream(true));
        }
    }

    reconcileCount() {
        const difference = this.targetCount - this.streams.length;
        if (difference > 0) {
            this.seedStreams(Math.min(24, difference));
        } else if (difference < -24) {
            this.streams.length = Math.max(this.targetCount, this.streams.length - 24);
        }
    }

    createStream(randomAge = false) {
        const longitude = randomBetween(GOMBE_BOUNDS.west, GOMBE_BOUNDS.east);
        const latitude = randomBetween(GOMBE_BOUNDS.south, GOMBE_BOUNDS.north);
        return {
            longitude,
            latitude,
            age: randomAge ? Math.random() * 5 : 0,
            lifetime: randomBetween(5, 11),
            speedFactor: randomBetween(0.72, 1.55),
            phase: Math.random() * Math.PI * 2,
            width: randomBetween(0.7, 1.8),
            opacity: randomBetween(0.35, 0.78),
            trail: [],
        };
    }

    respawn(stream) {
        const transport = (this.windDirection + 180) * Math.PI / 180;
        const upwindX = Math.sin(transport);
        const upwindY = Math.cos(transport);
        if (Math.abs(upwindX) > Math.abs(upwindY)) {
            stream.longitude = upwindX > 0 ? GOMBE_BOUNDS.west - Math.random() * 0.2 : GOMBE_BOUNDS.east + Math.random() * 0.2;
            stream.latitude = randomBetween(GOMBE_BOUNDS.south, GOMBE_BOUNDS.north);
        } else {
            stream.latitude = upwindY > 0 ? GOMBE_BOUNDS.south - Math.random() * 0.18 : GOMBE_BOUNDS.north + Math.random() * 0.18;
            stream.longitude = randomBetween(GOMBE_BOUNDS.west, GOMBE_BOUNDS.east);
        }
        stream.age = 0;
        stream.lifetime = randomBetween(5, 11);
        stream.phase = Math.random() * Math.PI * 2;
        stream.trail.length = 0;
    }

    localVector(longitude, latitude, timeSeconds, speedFactor) {
        const transportDirection = (this.windDirection + 180) % 360;
        const base = (90 - transportDirection) * Math.PI / 180;
        const terrainCurl = Math.sin(longitude * 6.4 + latitude * 7.6 + timeSeconds * 0.5) * 0.15;
        const corridorCurl = Math.cos(latitude * 10.2 - timeSeconds * 0.3) * 0.08;
        const angle = base + terrainCurl + corridorCurl;
        const velocity = (0.012 + this.windSpeed * 0.0028) * speedFactor * (this.boosted ? 1.35 : 1);
        return { x: Math.cos(angle) * velocity, y: Math.sin(angle) * velocity, angle };
    }

    spawnWavefront(now) {
        const interval = Math.max(420, 1550 - this.gustSpeed * 62);
        if (now - this.lastWaveSpawn < interval) return;
        this.lastWaveSpawn = now;
        this.wavefronts.push({
            longitude: randomBetween(GOMBE_BOUNDS.west, GOMBE_BOUNDS.east),
            latitude: randomBetween(GOMBE_BOUNDS.south, GOMBE_BOUNDS.north),
            age: 0,
            lifetime: randomBetween(1.6, 2.8),
            strength: clamp(this.gustSpeed / 15, 0.25, 1),
        });
        if (this.wavefronts.length > 16) this.wavefronts.shift();
    }

    drawGlobalRibbons(now, width, height) {
        const transportDirection = (this.windDirection + 180) % 360;
        const angle = (90 - transportDirection) * Math.PI / 180;
        const diagonal = Math.hypot(width, height);
        const baseLineCount = this.boosted ? 12 : 8;
        const lineCount = Math.max(4, Math.round(baseLineCount * Math.max(0.45, this.qualityScale)));
        const speed = 0.055 + this.windSpeed * 0.008;

        this.ctx.save();
        this.ctx.translate(width / 2, height / 2);
        this.ctx.rotate(angle);
        this.ctx.translate(-diagonal / 2, -diagonal / 2);
        this.ctx.lineCap = "round";
        this.ctx.globalCompositeOperation = "lighter";

        for (let row = 0; row < lineCount; row += 1) {
            const yBase = diagonal * (row + 0.55) / lineCount;
            const wobble = 8 + (row % 3) * 5;
            const phase = now * 0.0012 * (0.65 + this.windSpeed * 0.04) + row * 1.7;

            this.ctx.setLineDash([34 + row % 3 * 9, 20 + row % 2 * 10]);
            this.ctx.lineDashOffset = -now * speed - row * 19;
            this.ctx.lineWidth = row % 4 === 0 ? 2.3 : 1.25;
            this.ctx.shadowBlur = row % 4 === 0 ? 13 : 7;
            this.ctx.shadowColor = "rgba(92,255,239,.9)";
            this.ctx.strokeStyle = row % 4 === 0
                ? "rgba(170,255,246,.55)"
                : "rgba(77,232,225,.34)";
            this.ctx.beginPath();
            for (let x = -80; x <= diagonal + 80; x += 15) {
                const y = yBase
                    + Math.sin(x * 0.012 + phase) * wobble
                    + Math.cos(x * 0.004 - phase * 0.7) * 4;
                if (x === -80) this.ctx.moveTo(x, y);
                else this.ctx.lineTo(x, y);
            }
            this.ctx.stroke();

            const beadProgress = ((now * (0.00008 + this.windSpeed * 0.000012) + row * 0.083) % 1);
            const beadX = beadProgress * diagonal;
            const beadY = yBase + Math.sin(beadX * 0.012 + phase) * wobble;
            const beadRadius = row % 4 === 0 ? 3.4 : 2.1;
            const beadGlow = this.ctx.createRadialGradient(beadX, beadY, 0, beadX, beadY, beadRadius * 4.8);
            beadGlow.addColorStop(0, "rgba(236,255,252,1)");
            beadGlow.addColorStop(0.25, "rgba(123,255,243,.9)");
            beadGlow.addColorStop(1, "rgba(62,218,211,0)");
            this.ctx.fillStyle = beadGlow;
            this.ctx.beginPath();
            this.ctx.arc(beadX, beadY, beadRadius * 4.8, 0, Math.PI * 2);
            this.ctx.fill();
        }

        this.ctx.setLineDash([]);
        this.ctx.restore();
    }

    drawWavefronts(dt) {
        for (let index = this.wavefronts.length - 1; index >= 0; index -= 1) {
            const wave = this.wavefronts[index];
            wave.age += dt;
            if (wave.age >= wave.lifetime) {
                this.wavefronts.splice(index, 1);
                continue;
            }
            const point = this.map.project([wave.longitude, wave.latitude]);
            const progress = wave.age / wave.lifetime;
            const radius = 15 + progress * (88 + wave.strength * 70);
            const alpha = (1 - progress) * (0.28 + wave.strength * 0.24);
            this.ctx.save();
            this.ctx.globalCompositeOperation = "lighter";
            this.ctx.strokeStyle = `rgba(126,255,243,${alpha})`;
            this.ctx.lineWidth = 1.5 + wave.strength * 1.6;
            this.ctx.shadowBlur = 12;
            this.ctx.shadowColor = "rgba(75,238,228,.8)";
            this.ctx.beginPath();
            this.ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
            this.ctx.stroke();
            this.ctx.restore();
        }
    }

    updateFps(now) {
        this.frameCounter += 1;
        const elapsed = now - this.fpsWindowStarted;
        if (elapsed >= 650) {
            this.fps = Math.round(this.frameCounter * 1000 / elapsed);
            this.frameCounter = 0;
            this.fpsWindowStarted = now;
        }
    }

    animate(now) {
        if (this.paused || document.hidden || (this.minFrameInterval && now - this.lastRenderedAt < this.minFrameInterval)) {
            if (document.hidden) this.lastTime = now;
            requestAnimationFrame(this.animate);
            return;
        }
        this.lastRenderedAt = now;
        const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
        this.lastTime = now;
        this.updateFps(now);
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        this.ctx.clearRect(0, 0, width, height);
        this.visibleCount = 0;

        if (this.enabled) {
            const timeSeconds = now / 1000;
            this.spawnWavefront(now);
            this.drawGlobalRibbons(now, width, height);
            this.ctx.globalCompositeOperation = "lighter";
            this.ctx.lineCap = "round";
            this.ctx.lineJoin = "round";

            for (const stream of this.streams) {
                stream.age += dt;
                stream.phase += dt * (1 + this.windSpeed * 0.08);
                const vector = this.localVector(stream.longitude, stream.latitude, timeSeconds, stream.speedFactor);
                stream.longitude += vector.x * dt;
                stream.latitude += vector.y * dt;

                const outside = stream.longitude < GOMBE_BOUNDS.west - 0.3
                    || stream.longitude > GOMBE_BOUNDS.east + 0.3
                    || stream.latitude < GOMBE_BOUNDS.south - 0.27
                    || stream.latitude > GOMBE_BOUNDS.north + 0.27;
                if (stream.age > stream.lifetime || outside) {
                    this.respawn(stream);
                    continue;
                }

                const projected = this.map.project([stream.longitude, stream.latitude]);
                const point = {
                    x: projected.x + Math.sin(stream.phase * 1.5) * 4.5,
                    y: projected.y + Math.cos(stream.phase) * 2.8,
                };
                if (point.x < -50 || point.y < -50 || point.x > width + 50 || point.y > height + 50) continue;
                this.visibleCount += 1;

                stream.trail.push(point);
                const trailLength = Math.round(12 + Math.min(28, this.windSpeed * 1.8));
                while (stream.trail.length > trailLength) stream.trail.shift();
                if (stream.trail.length < 2) continue;

                const lifeFade = Math.sin(Math.PI * Math.min(1, stream.age / stream.lifetime));
                const alpha = clamp(stream.opacity * lifeFade * (0.85 + this.dispersion / 130) * (this.boosted ? 1.2 : 0.8), 0, 1);
                const first = stream.trail[0];
                const head = stream.trail[stream.trail.length - 1];
                const gradient = this.ctx.createLinearGradient(first.x, first.y, head.x, head.y);
                gradient.addColorStop(0, "rgba(51,214,208,0)");
                gradient.addColorStop(0.35, `rgba(70,235,226,${alpha * 0.45})`);
                gradient.addColorStop(0.78, `rgba(132,255,245,${alpha * 0.8})`);
                gradient.addColorStop(1, `rgba(235,255,253,${alpha})`);
                this.ctx.strokeStyle = gradient;
                this.ctx.lineWidth = stream.width + Math.min(2.4, this.windSpeed / 7);
                this.ctx.shadowBlur = 10;
                this.ctx.shadowColor = "rgba(79,240,230,.72)";
                this.ctx.beginPath();
                this.ctx.moveTo(first.x, first.y);
                for (let pointIndex = 1; pointIndex < stream.trail.length; pointIndex += 1) {
                    const trailPoint = stream.trail[pointIndex];
                    this.ctx.lineTo(trailPoint.x, trailPoint.y);
                }
                this.ctx.stroke();

                const headRadius = 1.8 + Math.min(2.4, this.windSpeed * 0.1);
                const glow = this.ctx.createRadialGradient(head.x, head.y, 0, head.x, head.y, headRadius * 4.5);
                glow.addColorStop(0, "rgba(244,255,254,1)");
                glow.addColorStop(0.25, `rgba(133,255,245,${alpha})`);
                glow.addColorStop(1, "rgba(63,221,214,0)");
                this.ctx.fillStyle = glow;
                this.ctx.beginPath();
                this.ctx.arc(head.x, head.y, headRadius * 4.5, 0, Math.PI * 2);
                this.ctx.fill();
            }

            this.drawWavefronts(dt);
            this.ctx.globalCompositeOperation = "source-over";
            this.ctx.shadowBlur = 0;
        }

        requestAnimationFrame(this.animate);
    }
}
