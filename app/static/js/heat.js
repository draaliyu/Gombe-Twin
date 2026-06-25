const GOMBE_BOUNDS = { west: 10.15, south: 9.45, east: 12.35, north: 11.55 };

function clamp(value, minimum, maximum) {
    return Math.max(minimum, Math.min(maximum, value));
}

export class HeatHazeField {
    constructor(map, canvas) {
        this.map = map;
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });
        this.enabled = true;
        this.boosted = true;
        this.temperature = 31;
        this.heatLoad = 42;
        this.thermalIntensity = 0;
        this.peakFrp = 0;
        this.hotspots = [];
        this.wavePackets = [];
        this.embers = [];
        this.lastTime = performance.now();
        this.lastPacketAt = 0;
        this.fps = 60;
        this.frameCounter = 0;
        this.fpsWindowStarted = performance.now();
        this.visiblePacketCount = 0;
        this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);
        this.resize = this.resize.bind(this);
        this.animate = this.animate.bind(this);

        window.addEventListener("resize", this.resize);
        this.map.on("resize", this.resize);
        this.resize();
        this.seedAmbientPackets(12);
        requestAnimationFrame(this.animate);
    }

    setTelemetry(frame, metrics = {}) {
        this.temperature = Number(frame.weather?.temperature_c) || 0;
        this.hotspots = Array.isArray(frame.hotspots) ? frame.hotspots : [];
        this.heatLoad = clamp(Number(metrics.surfaceHeatLoad) || 0, 0, 100);
        this.thermalIntensity = clamp(Number(metrics.thermalIntensity) || 0, 0, 100);
        this.peakFrp = Math.max(0, Number(metrics.peakFrp) || 0);

        const targetPackets = Math.round(8 + this.heatLoad * 0.28 + this.hotspots.length * 2.5);
        while (this.wavePackets.length < Math.min(58, targetPackets)) {
            this.wavePackets.push(this.createWavePacket(true));
        }
        if (this.wavePackets.length > targetPackets + 8) {
            this.wavePackets.length = Math.max(targetPackets, this.wavePackets.length - 5);
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
            packetCount: this.wavePackets.length,
            visiblePacketCount: this.visiblePacketCount,
            emberCount: this.embers.length,
            heatLoad: this.heatLoad,
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

    seedAmbientPackets(count) {
        for (let index = 0; index < count; index += 1) {
            this.wavePackets.push(this.createWavePacket(true));
        }
    }

    createWavePacket(randomAge = false) {
        const hotspot = this.hotspots.length && Math.random() < 0.62
            ? this.hotspots[Math.floor(Math.random() * this.hotspots.length)]
            : null;
        const longitude = hotspot
            ? Number(hotspot.longitude) + (Math.random() - 0.5) * 0.11
            : GOMBE_BOUNDS.west + Math.random() * (GOMBE_BOUNDS.east - GOMBE_BOUNDS.west);
        const latitude = hotspot
            ? Number(hotspot.latitude) + (Math.random() - 0.5) * 0.11
            : GOMBE_BOUNDS.south + Math.random() * (GOMBE_BOUNDS.north - GOMBE_BOUNDS.south);

        return {
            longitude,
            latitude,
            age: randomAge ? Math.random() * 5 : 0,
            lifetime: 3.6 + Math.random() * 5.4,
            radius: 12 + Math.random() * 34,
            drift: (Math.random() - 0.5) * 0.0022,
            phase: Math.random() * Math.PI * 2,
            frequency: 0.035 + Math.random() * 0.04,
            amplitude: 1.2 + Math.random() * 3.8,
            hotspotStrength: hotspot ? clamp((Number(hotspot.frp) || 0) / 80, 0.18, 1) : 0.18 + Math.random() * 0.25,
        };
    }

    createEmber(hotspot) {
        return {
            longitude: Number(hotspot.longitude) + (Math.random() - 0.5) * 0.025,
            latitude: Number(hotspot.latitude) + (Math.random() - 0.5) * 0.025,
            age: 0,
            lifetime: 0.9 + Math.random() * 1.8,
            lift: 12 + Math.random() * 35,
            drift: (Math.random() - 0.5) * 14,
            size: 0.8 + Math.random() * 2.2,
            phase: Math.random() * Math.PI * 2,
        };
    }

    drawAmbientVeil(now, width, height) {
        const load = this.heatLoad / 100;
        if (load <= 0.03) return;

        const horizontalShift = Math.sin(now * 0.00013) * width * 0.06;
        const gradient = this.ctx.createRadialGradient(
            width * 0.57 + horizontalShift,
            height * 0.58,
            0,
            width * 0.57 + horizontalShift,
            height * 0.58,
            Math.max(width, height) * 0.52,
        );
        gradient.addColorStop(0, `rgba(255, 126, 55, ${0.055 + load * (this.boosted ? 0.13 : 0.08)})`);
        gradient.addColorStop(0.35, `rgba(255, 189, 84, ${0.025 + load * (this.boosted ? 0.075 : 0.045)})`);
        gradient.addColorStop(0.72, "rgba(255, 106, 48, 0.012)");
        gradient.addColorStop(1, "rgba(255, 106, 48, 0)");
        this.ctx.fillStyle = gradient;
        this.ctx.fillRect(0, 0, width, height);

        this.ctx.save();
        this.ctx.globalAlpha = 0.055 + load * (this.boosted ? 0.17 : 0.1);
        this.ctx.strokeStyle = "rgba(255, 196, 104, 0.75)";
        this.ctx.lineWidth = this.boosted ? 1.15 : 0.75;
        const baseY = height * 0.72;
        for (let row = 0; row < 9; row += 1) {
            this.ctx.beginPath();
            const y = baseY + row * 7;
            for (let x = -20; x <= width + 20; x += 8) {
                const waveY = y
                    + Math.sin(x * 0.022 + now * 0.0012 + row * 0.9) * (1.2 + load * 3.5)
                    + Math.sin(x * 0.006 - now * 0.0007) * 2.1;
                if (x === -20) this.ctx.moveTo(x, waveY);
                else this.ctx.lineTo(x, waveY);
            }
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    drawWavePacket(packet, now, width, height) {
        const point = this.map.project([packet.longitude, packet.latitude]);
        if (point.x < -100 || point.y < -100 || point.x > width + 100 || point.y > height + 100) return;

        const progress = clamp(packet.age / packet.lifetime, 0, 1);
        const fade = Math.sin(Math.PI * progress);
        const strength = clamp((this.heatLoad / 100) * 0.82 + packet.hotspotStrength * 0.72, 0.12, this.boosted ? 1.7 : 1.35);
        const radius = packet.radius + progress * (32 + packet.hotspotStrength * 46);
        const verticalRise = progress * (14 + packet.hotspotStrength * 30);

        this.ctx.save();
        this.ctx.translate(point.x, point.y - verticalRise);
        this.ctx.globalCompositeOperation = "lighter";
        this.ctx.globalAlpha = fade * strength * (this.boosted ? 0.82 : 0.58);
        this.ctx.shadowBlur = 13 + packet.hotspotStrength * 16;
        this.ctx.shadowColor = "rgba(255, 112, 55, 0.55)";

        for (let band = 0; band < 3; band += 1) {
            const bandRadius = radius + band * 9;
            const verticalScale = 0.24 + band * 0.055;
            const gradient = this.ctx.createLinearGradient(-bandRadius, 0, bandRadius, 0);
            gradient.addColorStop(0, "rgba(255, 181, 73, 0)");
            gradient.addColorStop(0.25, "rgba(255, 196, 92, 0.42)");
            gradient.addColorStop(0.5, "rgba(255, 119, 57, 0.72)");
            gradient.addColorStop(0.75, "rgba(255, 196, 92, 0.42)");
            gradient.addColorStop(1, "rgba(255, 181, 73, 0)");
            this.ctx.strokeStyle = gradient;
            this.ctx.lineWidth = Math.max(0.7, 1.3 - band * 0.22);
            this.ctx.beginPath();
            for (let x = -bandRadius; x <= bandRadius; x += 4) {
                const ellipseY = Math.sqrt(Math.max(0, 1 - (x * x) / (bandRadius * bandRadius))) * bandRadius * verticalScale;
                const ripple = Math.sin(x * packet.frequency + now * 0.002 + packet.phase + band) * packet.amplitude;
                const y = -(ellipseY + ripple);
                if (x === -bandRadius) this.ctx.moveTo(x, y);
                else this.ctx.lineTo(x, y);
            }
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    drawEmber(ember, now, width, height) {
        const point = this.map.project([ember.longitude, ember.latitude]);
        if (point.x < -40 || point.y < -40 || point.x > width + 40 || point.y > height + 40) return;
        const progress = clamp(ember.age / ember.lifetime, 0, 1);
        const alpha = (1 - progress) * (0.35 + this.thermalIntensity / 130);
        const x = point.x + ember.drift * progress + Math.sin(now * 0.008 + ember.phase) * 2.2;
        const y = point.y - ember.lift * progress;
        const radius = ember.size * (1 - progress * 0.45);

        this.ctx.save();
        this.ctx.globalCompositeOperation = "lighter";
        this.ctx.globalAlpha = clamp(alpha, 0, 0.95);
        this.ctx.shadowBlur = 14;
        this.ctx.shadowColor = "rgba(255, 96, 45, 0.95)";
        const gradient = this.ctx.createRadialGradient(x, y, 0, x, y, radius * 4.2);
        gradient.addColorStop(0, "rgba(255,255,226,1)");
        gradient.addColorStop(0.18, "rgba(255,219,105,.95)");
        gradient.addColorStop(0.48, "rgba(255,106,47,.62)");
        gradient.addColorStop(1, "rgba(255,71,35,0)");
        this.ctx.fillStyle = gradient;
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius * 4.2, 0, Math.PI * 2);
        this.ctx.fill();
        this.ctx.restore();
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

    drawThermalSweep(now, width, height) {
        const load = this.heatLoad / 100;
        if (load < 0.05) return;
        const direction = now * 0.00022;
        const centerX = width * (0.5 + Math.sin(direction) * 0.14);
        const centerY = height * (0.62 + Math.cos(direction * 0.7) * 0.05);
        this.ctx.save();
        this.ctx.globalCompositeOperation = "lighter";
        for (let ring = 0; ring < 4; ring += 1) {
            const phase = (now * 0.00018 + ring * 0.23) % 1;
            const radius = 45 + phase * Math.max(width, height) * 0.42;
            this.ctx.globalAlpha = (1 - phase) * (0.07 + load * (this.boosted ? 0.18 : 0.1));
            this.ctx.strokeStyle = ring % 2 ? "rgba(255,176,72,.9)" : "rgba(255,91,54,.9)";
            this.ctx.lineWidth = this.boosted ? 2.2 : 1.2;
            this.ctx.shadowBlur = 18;
            this.ctx.shadowColor = "rgba(255,91,54,.8)";
            this.ctx.beginPath();
            this.ctx.ellipse(centerX, centerY, radius, radius * 0.28, 0, 0, Math.PI * 2);
            this.ctx.stroke();
        }
        this.ctx.restore();
    }

    animate(now) {
        const dt = Math.min(0.05, Math.max(0.001, (now - this.lastTime) / 1000));
        this.lastTime = now;
        this.updateFps(now);
        const width = this.canvas.clientWidth;
        const height = this.canvas.clientHeight;
        this.ctx.clearRect(0, 0, width, height);
        this.visiblePacketCount = 0;

        if (this.enabled) {
            this.drawAmbientVeil(now, width, height);
            this.drawThermalSweep(now, width, height);

            if (now - this.lastPacketAt > Math.max(90, 430 - this.heatLoad * 3.1)) {
                this.lastPacketAt = now;
                this.wavePackets.push(this.createWavePacket(false));
                if (this.hotspots.length && Math.random() < 0.72) {
                    const hotspot = this.hotspots[Math.floor(Math.random() * this.hotspots.length)];
                    const emberCount = 1 + Math.floor(Math.random() * (2 + this.thermalIntensity / 28));
                    for (let index = 0; index < emberCount; index += 1) {
                        this.embers.push(this.createEmber(hotspot));
                    }
                }
            }

            for (let index = this.wavePackets.length - 1; index >= 0; index -= 1) {
                const packet = this.wavePackets[index];
                packet.age += dt;
                packet.longitude += packet.drift * dt;
                if (packet.age >= packet.lifetime) {
                    this.wavePackets.splice(index, 1);
                    continue;
                }
                this.drawWavePacket(packet, now, width, height);
                this.visiblePacketCount += 1;
            }

            for (let index = this.embers.length - 1; index >= 0; index -= 1) {
                const ember = this.embers[index];
                ember.age += dt;
                if (ember.age >= ember.lifetime) {
                    this.embers.splice(index, 1);
                    continue;
                }
                this.drawEmber(ember, now, width, height);
            }
        }

        requestAnimationFrame(this.animate);
    }
}
