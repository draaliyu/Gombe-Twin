const DEFAULT_GOMBE_BOUNDS = { west: 10.15, south: 9.45, east: 12.35, north: 11.55 };

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

function randomBetween(minimum, maximum) {
    return minimum + Math.random() * (maximum - minimum);
}

function normaliseBoundary(boundary) {
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

function pointInPolygon(longitude, latitude, polygon) {
    if (!polygon?.length || !pointInRing(longitude, latitude, polygon[0])) return false;
    for (let index = 1; index < polygon.length; index += 1) {
        if (pointInRing(longitude, latitude, polygon[index])) return false;
    }
    return true;
}

function boundsFromPolygons(polygons) {
    if (!polygons.length) return { ...DEFAULT_GOMBE_BOUNDS };
    let west = Infinity;
    let south = Infinity;
    let east = -Infinity;
    let north = -Infinity;
    for (const polygon of polygons) {
        for (const ring of polygon) {
            for (const coordinate of ring) {
                const [longitude, latitude] = coordinate;
                west = Math.min(west, longitude);
                south = Math.min(south, latitude);
                east = Math.max(east, longitude);
                north = Math.max(north, latitude);
            }
        }
    }
    return Number.isFinite(west) ? { west, south, east, north } : { ...DEFAULT_GOMBE_BOUNDS };
}

export class DustParticleField {
    constructor(map, canvas) {
        this.map = map;
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
        this.enabled = true;
        this.boosted = true;
        this.particles = [];
        this.heroSparkles = [];
        this.flashBursts = [];
        this.boundaryPolygons = [];
        this.bounds = { ...DEFAULT_GOMBE_BOUNDS };
        this.targetCount = 520;
        this.targetHeroCount = 5;
        this.radiantCount = 0;
        this.visibleCount = 0;
        this.windSpeed = 7;
        this.windDirection = 52;
        this.pm25 = 40;
        this.pm10 = 90;
        this.humidity = 25;
        this.temperature = 31;
        this.dustIndex = 35;
        this.severity = 35;
        this.radiance = 35;
        this.hotspots = [];
        this.lastTime = performance.now();
        this.lastFlashAt = 0;
        this.frameCounter = 0;
        this.fps = 60;
        this.fpsWindowStarted = performance.now();
        this.qualityMode = "desktop";
        this.qualityScale = 1;
        this.minFrameInterval = 0;
        this.lastRenderedAt = 0;
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.55);
        this.sprites = this.createPointSprites();
        this.resize = this.resize.bind(this);
        this.animate = this.animate.bind(this);

        window.addEventListener("resize", this.resize);
        this.map.on("resize", this.resize);
        this.resize();
        this.seedParticles(this.targetCount);
        this.reconcileHeroCount();
        requestAnimationFrame(this.animate);
    }

    createPointSprites() {
        const palettes = [
            ["255,255,242", "255,211,111", "255,139,52"],
            ["255,252,230", "255,185,82", "255,103,43"],
            ["237,255,249", "255,224,139", "255,153,63"],
        ];
        const sprites = [];
        for (const palette of palettes) {
            for (let level = 0; level < 3; level += 1) {
                const size = 20 + level * 6;
                const sprite = document.createElement("canvas");
                sprite.width = size;
                sprite.height = size;
                const ctx = sprite.getContext("2d");
                const radius = size / 2;
                const [core, middle, edge] = palette;
                const halo = ctx.createRadialGradient(radius, radius, 0, radius, radius, radius);
                halo.addColorStop(0, `rgba(${core},1)`);
                halo.addColorStop(0.13, `rgba(${core},.98)`);
                halo.addColorStop(0.34, `rgba(${middle},.82)`);
                halo.addColorStop(0.67, `rgba(${edge},.25)`);
                halo.addColorStop(1, `rgba(${edge},0)`);
                ctx.fillStyle = halo;
                ctx.fillRect(0, 0, size, size);
                ctx.fillStyle = `rgba(${core},1)`;
                ctx.beginPath();
                ctx.arc(radius, radius, 1.05 + level * 0.28, 0, Math.PI * 2);
                ctx.fill();
                sprites.push(sprite);
            }
        }
        return sprites;
    }

    setBoundary(boundary) {
        const polygons = normaliseBoundary(boundary);
        if (!polygons.length) return;
        this.boundaryPolygons = polygons;
        this.bounds = boundsFromPolygons(polygons);
        this.particles = [];
        this.heroSparkles = [];
        this.seedParticles(this.targetCount);
        this.reconcileHeroCount();
    }

    isInside(longitude, latitude) {
        if (!this.boundaryPolygons.length) {
            return longitude >= this.bounds.west
                && longitude <= this.bounds.east
                && latitude >= this.bounds.south
                && latitude <= this.bounds.north;
        }
        return this.boundaryPolygons.some((polygon) => pointInPolygon(longitude, latitude, polygon));
    }

    randomPointInside() {
        for (let attempt = 0; attempt < 120; attempt += 1) {
            const longitude = randomBetween(this.bounds.west, this.bounds.east);
            const latitude = randomBetween(this.bounds.south, this.bounds.north);
            if (this.isInside(longitude, latitude)) return [longitude, latitude];
        }
        return [11.1673, 10.2897];
    }

    setQuality(mode = "desktop") {
        this.qualityMode = mode;
        const profiles = {
            desktop: { scale: 1, dpr: 1.55, interval: 0 },
            tablet: { scale: 0.62, dpr: 1.2, interval: 22 },
            mobile: { scale: 0.34, dpr: 1, interval: 33 },
        };
        const profile = profiles[mode] || profiles.desktop;
        this.qualityScale = profile.scale;
        this.minFrameInterval = profile.interval;
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, profile.dpr);
        this.recalculateTargets();
        this.resize();
    }

    recalculateTargets() {
        const severityRatio = this.severity / 100;
        this.targetCount = Math.max(45, Math.round((90 + 2450 * Math.pow(severityRatio, 1.72)) * this.qualityScale));
        this.targetHeroCount = Math.max(1, Math.round((1 + 24 * Math.pow(severityRatio, 1.85)) * Math.max(0.3, this.qualityScale)));
        this.reconcileParticleCount();
        this.reconcileHeroCount();
    }

    setTelemetry(frame) {
        this.windSpeed = Number(frame.weather?.wind_speed_ms) || 0;
        this.windDirection = Number(frame.weather?.wind_direction_deg) || 0;
        this.pm25 = Number(frame.air_quality?.pm25) || 0;
        this.pm10 = Number(frame.air_quality?.pm10) || 0;
        this.humidity = Number(frame.weather?.humidity_pct) || 0;
        this.temperature = Number(frame.weather?.temperature_c) || 0;
        this.dustIndex = Number(frame.derived?.dust_index) || 0;
        this.hotspots = (Array.isArray(frame.hotspots) ? frame.hotspots : []).filter((hotspot) => (
            this.isInside(Number(hotspot.longitude), Number(hotspot.latitude))
        ));

        const pm10Severity = clamp((this.pm10 / 260) * 100, 0, 100);
        const pm25Severity = clamp((this.pm25 / 130) * 100, 0, 100);
        this.severity = clamp(
            this.dustIndex * 0.64 + pm10Severity * 0.25 + pm25Severity * 0.11,
            0,
            100,
        );
        const severityRatio = this.severity / 100;
        this.radiance = clamp(7 + 93 * Math.pow(severityRatio, 1.32), 7, 100);
        this.recalculateTargets();
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
            particleCount: this.particles.length,
            radiantCount: this.radiantCount,
            visibleCount: this.visibleCount,
            burstCount: this.flashBursts.length,
            radiance: this.radiance,
            severity: this.severity,
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

    seedParticles(count) {
        for (let index = 0; index < count; index += 1) this.particles.push(this.createParticle(true));
    }

    reconcileParticleCount() {
        const difference = this.targetCount - this.particles.length;
        if (difference > 0) {
            this.seedParticles(Math.min(220, difference));
        } else if (difference < -180) {
            this.particles.length = Math.max(this.targetCount, this.particles.length - 180);
        }
    }

    reconcileHeroCount() {
        while (this.heroSparkles.length < this.targetHeroCount) {
            const [longitude, latitude] = this.randomPointInside();
            this.heroSparkles.push({
                longitude,
                latitude,
                phase: Math.random() * Math.PI * 2,
                flashSpeed: randomBetween(1.8, 4.8),
                size: randomBetween(0.85, 1.65),
                speedFactor: randomBetween(0.65, 1.25),
                turbulence: Math.random() * Math.PI * 2,
            });
        }
        if (this.heroSparkles.length > this.targetHeroCount) this.heroSparkles.length = this.targetHeroCount;
    }

    createParticle(randomAge = false) {
        let [longitude, latitude] = this.randomPointInside();
        if (this.hotspots.length && Math.random() < 0.1) {
            const hotspot = this.hotspots[Math.floor(Math.random() * this.hotspots.length)];
            for (let attempt = 0; attempt < 20; attempt += 1) {
                const candidateLongitude = Number(hotspot.longitude) + randomBetween(-0.045, 0.045);
                const candidateLatitude = Number(hotspot.latitude) + randomBetween(-0.045, 0.045);
                if (this.isInside(candidateLongitude, candidateLatitude)) {
                    longitude = candidateLongitude;
                    latitude = candidateLatitude;
                    break;
                }
            }
        }
        return {
            longitude,
            latitude,
            previousScreenX: null,
            previousScreenY: null,
            altitude: Math.random(),
            age: randomAge ? Math.random() * 11 : 0,
            lifetime: randomBetween(8, 19),
            size: randomBetween(0.42, 1.12),
            opacity: randomBetween(0.32, 0.92),
            turbulence: Math.random() * Math.PI * 2,
            speedFactor: randomBetween(0.62, 1.42),
            spriteIndex: Math.floor(Math.random() * this.sprites.length),
            twinklePhase: Math.random() * Math.PI * 2,
            twinkleSpeed: randomBetween(2.0, 6.4),
            sparkleBias: Math.random(),
            screenDrift: randomBetween(0.5, 2.6),
        };
    }

    createSparkBurst(width, height) {
        const point = this.randomPointInside();
        const projected = this.map.project(point);
        return {
            x: clamp(projected.x, 0, width),
            y: clamp(projected.y, 0, height),
            age: 0,
            lifetime: randomBetween(0.22, 0.46),
            radius: randomBetween(1.8, 4.8),
            rotation: Math.random() * Math.PI,
        };
    }

    spawnFlash(now, width, height) {
        if (this.severity < 38) return;
        const severityRatio = (this.severity - 38) / 62;
        const baseInterval = 1750 - severityRatio * 1480;
        const interval = randomBetween(baseInterval * 0.75, baseInterval * 1.25) * (this.boosted ? 0.82 : 1.25);
        if (now - this.lastFlashAt < interval) return;
        this.lastFlashAt = now;
        const count = this.severity >= 82 ? 2 : 1;
        for (let index = 0; index < count; index += 1) this.flashBursts.push(this.createSparkBurst(width, height));
        if (this.flashBursts.length > 20) this.flashBursts.splice(0, this.flashBursts.length - 20);
    }

    drawAtmosphericGlow(now, width, height) {
        const strength = Math.pow(this.severity / 100, 1.6);
        if (strength < 0.04) return;
        const x = width * 0.52 + Math.sin(now * 0.00018) * width * 0.08;
        const y = height * 0.5 + Math.cos(now * 0.00014) * height * 0.04;
        const radius = Math.max(width, height) * 0.48;
        const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(255,179,75,${strength * 0.035})`);
        gradient.addColorStop(0.45, `rgba(255,113,45,${strength * 0.018})`);
        gradient.addColorStop(1, "rgba(255,90,35,0)");
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, width, height);
    }

    drawHeroSparkles(now, dt, width, height) {
        if (!this.heroSparkles.length) return;
        const transportDirection = (this.windDirection + 180) % 360;
        const angle = (90 - transportDirection) * Math.PI / 180;
        const speed = (0.008 + Math.max(0.7, this.windSpeed) * 0.0018) * dt;
        const severityRatio = this.severity / 100;
        for (const sparkle of this.heroSparkles) {
            sparkle.turbulence += dt * 1.4;
            sparkle.longitude += Math.cos(angle) * speed * sparkle.speedFactor;
            sparkle.latitude += Math.sin(angle) * speed * sparkle.speedFactor;
            sparkle.longitude += Math.sin(sparkle.turbulence) * 0.00022 * dt;
            sparkle.latitude += Math.cos(sparkle.turbulence * 0.8) * 0.00018 * dt;
            if (!this.isInside(sparkle.longitude, sparkle.latitude)) {
                [sparkle.longitude, sparkle.latitude] = this.randomPointInside();
            }
            const projected = this.map.project([sparkle.longitude, sparkle.latitude]);
            if (projected.x < -15 || projected.y < -15 || projected.x > width + 15 || projected.y > height + 15) continue;
            const wave = 0.5 + 0.5 * Math.sin(now * 0.001 * sparkle.flashSpeed + sparkle.phase);
            const flash = Math.pow(wave, 5.8);
            const alpha = clamp((0.08 + severityRatio * 0.48) * (0.5 + flash * 1.2), 0, 0.95);
            const size = sparkle.size * (0.9 + severityRatio * 0.9 + flash * 0.65);
            this.drawStarGlint(projected.x, projected.y, size, alpha, sparkle.phase + now * 0.00016);
            this.radiantCount += 1;
        }
    }

    drawStarGlint(x, y, size, alpha, rotation) {
        this.ctx.save();
        this.ctx.translate(x, y);
        this.ctx.rotate(rotation);
        this.ctx.globalCompositeOperation = "lighter";
        this.ctx.globalAlpha = alpha;
        this.ctx.shadowBlur = 5 + size * 2;
        this.ctx.shadowColor = "rgba(255,177,77,.9)";
        this.ctx.fillStyle = "rgba(255,252,224,.98)";
        this.ctx.beginPath();
        this.ctx.arc(0, 0, Math.max(0.65, size * 0.55), 0, Math.PI * 2);
        this.ctx.fill();
        const ray = 2.2 + size * 1.6;
        this.ctx.strokeStyle = "rgba(255,243,196,.8)";
        this.ctx.lineWidth = 0.55;
        this.ctx.beginPath();
        this.ctx.moveTo(-ray, 0);
        this.ctx.lineTo(ray, 0);
        this.ctx.moveTo(0, -ray);
        this.ctx.lineTo(0, ray);
        this.ctx.stroke();
        this.ctx.restore();
    }

    drawFlashBursts(dt, now) {
        for (let index = this.flashBursts.length - 1; index >= 0; index -= 1) {
            const burst = this.flashBursts[index];
            burst.age += dt;
            if (burst.age >= burst.lifetime) {
                this.flashBursts.splice(index, 1);
                continue;
            }
            const progress = burst.age / burst.lifetime;
            const fade = Math.pow(1 - progress, 1.8);
            const size = burst.radius * (0.8 + progress * 0.9);
            this.drawStarGlint(burst.x, burst.y, size, fade * 0.85, burst.rotation + now * 0.00035);
            this.ctx.save();
            this.ctx.globalCompositeOperation = "lighter";
            this.ctx.globalAlpha = fade * 0.35;
            this.ctx.strokeStyle = "rgba(255,184,91,.9)";
            this.ctx.lineWidth = 0.65;
            this.ctx.beginPath();
            this.ctx.arc(burst.x, burst.y, size * (1.3 + progress), 0, Math.PI * 2);
            this.ctx.stroke();
            this.ctx.restore();
        }
    }

    drawParticleTrail(x1, y1, x2, y2, radius, alpha) {
        if (x1 === null || y1 === null) return;
        const dx = x2 - x1;
        const dy = y2 - y1;
        const length = Math.hypot(dx, dy);
        if (length < 0.06 || length > 22) return;
        const stretch = 2.2 + Math.min(8, this.windSpeed * 0.45);
        const tailX = x2 - dx * stretch;
        const tailY = y2 - dy * stretch;
        const gradient = this.ctx.createLinearGradient(tailX, tailY, x2, y2);
        gradient.addColorStop(0, "rgba(255,112,40,0)");
        gradient.addColorStop(1, `rgba(255,213,128,${alpha * 0.42})`);
        this.ctx.strokeStyle = gradient;
        this.ctx.lineWidth = Math.max(0.35, radius * 0.34);
        this.ctx.beginPath();
        this.ctx.moveTo(tailX, tailY);
        this.ctx.lineTo(x2, y2);
        this.ctx.stroke();
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
        if (document.hidden || (this.minFrameInterval && now - this.lastRenderedAt < this.minFrameInterval)) {
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
        this.radiantCount = 0;
        this.visibleCount = 0;

        if (this.enabled) {
            const transportDirection = (this.windDirection + 180) % 360;
            const windRadians = (90 - transportDirection) * Math.PI / 180;
            const dryness = clamp(1 - this.humidity / 100, 0.1, 1);
            const severityRatio = this.severity / 100;
            const velocity = (0.01 + Math.max(0.8, this.windSpeed) * 0.0028) * (this.boosted ? 1.16 : 1);
            const brightness = 0.1 + 0.9 * Math.pow(severityRatio, 1.35);
            const sizeBoost = 0.82 + 1.1 * Math.pow(severityRatio, 0.72);
            const opacityBoost = (this.boosted ? 1.08 : 0.82) * brightness;

            this.drawAtmosphericGlow(now, width, height);
            this.spawnFlash(now, width, height);
            this.ctx.globalCompositeOperation = "lighter";
            this.ctx.lineCap = "round";

            for (let index = 0; index < this.particles.length; index += 1) {
                let particle = this.particles[index];
                particle.age += dt;
                particle.turbulence += dt * (0.8 + dryness * 1.5 + particle.altitude * 0.5);
                const curl = Math.sin(particle.turbulence * 1.6 + particle.latitude * 4.1) * 0.0018 * dryness;
                const lift = Math.cos(particle.turbulence * 1.15 + particle.longitude * 2.7) * 0.0012;
                particle.longitude += (Math.cos(windRadians) * velocity * particle.speedFactor + curl) * dt;
                particle.latitude += (Math.sin(windRadians) * velocity * particle.speedFactor + lift) * dt;
                particle.altitude = clamp(particle.altitude + Math.sin(particle.turbulence) * dt * 0.05, 0, 1);

                if (particle.age > particle.lifetime || !this.isInside(particle.longitude, particle.latitude)) {
                    particle = this.createParticle(false);
                    this.particles[index] = particle;
                }

                const projected = this.map.project([particle.longitude, particle.latitude]);
                const x = projected.x + Math.sin(particle.turbulence + particle.twinklePhase) * particle.screenDrift;
                const y = projected.y + Math.cos(particle.turbulence * 0.82 + particle.twinklePhase) * particle.screenDrift * 0.6;
                if (x < -18 || y < -18 || x > width + 18 || y > height + 18) {
                    particle.previousScreenX = null;
                    particle.previousScreenY = null;
                    continue;
                }
                this.visibleCount += 1;

                const lifeFade = Math.sin(Math.PI * clamp(particle.age / particle.lifetime, 0, 1));
                const wave = 0.5 + 0.5 * Math.sin(now * 0.001 * particle.twinkleSpeed + particle.twinklePhase);
                const sharpFlash = Math.pow(wave, 5.1);
                const radius = particle.size * sizeBoost * (0.72 + particle.altitude * 0.42);
                const alpha = clamp(
                    particle.opacity * lifeFade * opacityBoost * (0.52 + wave * 0.48),
                    0,
                    0.92,
                );
                const sprite = this.sprites[particle.spriteIndex];
                const spriteSize = clamp(3.4 + radius * 4.2 + sharpFlash * 2.4, 3.5, 12.5);

                this.drawParticleTrail(particle.previousScreenX, particle.previousScreenY, x, y, radius, alpha);
                particle.previousScreenX = x;
                particle.previousScreenY = y;

                this.ctx.save();
                this.ctx.globalAlpha = alpha;
                this.ctx.shadowBlur = 2 + radius * 2.4 + sharpFlash * 4.5;
                this.ctx.shadowColor = "rgba(255,150,57,.72)";
                this.ctx.drawImage(sprite, x - spriteSize / 2, y - spriteSize / 2, spriteSize, spriteSize);
                this.ctx.restore();

                const radiantThreshold = 0.93 - severityRatio * 0.24;
                if (particle.sparkleBias > radiantThreshold) {
                    this.radiantCount += 1;
                    if (sharpFlash > 0.56 && this.severity >= 28) {
                        this.drawStarGlint(
                            x,
                            y,
                            clamp(radius * (0.72 + sharpFlash), 0.8, 2.7),
                            alpha * (0.28 + sharpFlash * 0.62),
                            particle.twinklePhase + now * 0.00012,
                        );
                    }
                }
            }

            this.drawHeroSparkles(now, dt, width, height);
            this.drawFlashBursts(dt, now);
            this.ctx.globalAlpha = 1;
            this.ctx.shadowBlur = 0;
            this.ctx.globalCompositeOperation = "source-over";
        }

        requestAnimationFrame(this.animate);
    }
}
