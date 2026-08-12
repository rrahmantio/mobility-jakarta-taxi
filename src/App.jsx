import React, { useState, useMemo, useRef, useCallback } from "react";
import {
  MapPin, ZoomIn, ZoomOut, RotateCcw, Layers, Search, Info, TrendingUp,
  TrendingDown, Clock, ChevronRight, X, Navigation, Car, Users, AlertCircle,
  ChevronDown, Radio, Building2, Home, Bike, Bus
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, Tooltip as RTooltip,
  ResponsiveContainer, CartesianGrid, Cell, ReferenceLine
} from "recharts";

/* ============================================================
   UTILITIES
   ============================================================ */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function mulberry32(seed) {
  let a = seed;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatNumber(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  if (Math.abs(n) >= 1000000) return (n / 1000000).toFixed(2) + "M";
  if (Math.abs(n) >= 1000) return Math.round(n).toLocaleString("en-US");
  return Math.round(n).toString();
}
const formatInt = (n) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("en-US"));
const formatPct = (n, d = 1) => (n === null || n === undefined ? "—" : n.toFixed(d) + "%");
const formatSigned = (n, d = 1, suffix = "%") => (n >= 0 ? "+" : "") + n.toFixed(d) + suffix;
const formatKm = (n) => n.toFixed(1) + " km";
const formatMin = (n) => Math.round(n) + " min";

/* ============================================================
   MOCK DATA GENERATION
   ============================================================ */
const DISTRICT_PROFILES = {
  "Central Jakarta": { office: 0.92, resi: 0.32, income: 0.82, transit: 0.78, pop: 0.55 },
  "South Jakarta": { office: 0.5, resi: 0.68, income: 0.78, transit: 0.5, pop: 0.5 },
  "East Jakarta": { office: 0.32, resi: 0.82, income: 0.42, transit: 0.42, pop: 0.78 },
  "North Jakarta": { office: 0.48, resi: 0.58, income: 0.48, transit: 0.4, pop: 0.62 },
  "West Jakarta": { office: 0.38, resi: 0.78, income: 0.4, transit: 0.48, pop: 0.8 },
};

const AGE_KEYS = ["a18_24", "a25_34", "a35_44", "a45_54", "a55_64", "a65p"];
const AGE_LABELS = { a18_24: "18–24", a25_34: "25–34", a35_44: "35–44", a45_54: "45–54", a55_64: "55–64", a65p: "65+" };
const AGE_BASE_PROPENSITY = { a18_24: 14.2, a25_34: 23.7, a35_44: 24.9, a45_54: 21.1, a55_64: 18.6, a65p: 16.3 };
const SOCIO_BASE_PROPENSITY = { A: 27.4, B: 20.1, C: 12.8 };

function generateHexGrid(seed = 42) {
  const rng = mulberry32(seed);
  const R = 8, size = 17;
  const hexes = [];
  let idx = 0;
  for (let q = -R; q <= R; q++) {
    const r1 = Math.max(-R, -q - R), r2 = Math.min(R, -q + R);
    for (let r = r1; r <= r2; r++) {
      const x = size * 1.5 * q;
      const y = size * Math.sqrt(3) * (r + q / 2);
      const ring = (Math.abs(q) + Math.abs(r) + Math.abs(-q - r)) / 2;
      const angle = (Math.atan2(-y, x) * 180) / Math.PI;
      let district;
      if (ring <= 2) district = "Central Jakarta";
      else if (angle > -45 && angle <= 45) district = "East Jakarta";
      else if (angle > 45 && angle <= 135) district = "North Jakarta";
      else if (angle > 135 || angle <= -135) district = "West Jakarta";
      else district = "South Jakarta";
      idx++;
      hexes.push({ id: `HEX-JKT-${String(idx).padStart(3, "0")}`, q, r, x, y, ring, angle, district });
    }
  }

  const hubSeeds = [{ ang: 0, ring: 5 }, { ang: 90, ring: 5 }, { ang: 180, ring: 5 }, { ang: -90, ring: 5 }, { ang: 45, ring: 6 }];
  hubSeeds.forEach((hs) => {
    let best = null, bestDist = Infinity;
    hexes.forEach((h) => {
      const angDiff = Math.min(Math.abs(h.angle - hs.ang), 360 - Math.abs(h.angle - hs.ang));
      const d = Math.abs(h.ring - hs.ring) + angDiff / 30;
      if (d < bestDist) { bestDist = d; best = h; }
    });
    if (best) best.isHub = true;
  });

  hexes.forEach((h) => {
    const profile = DISTRICT_PROFILES[h.district];
    const noise = (Math.sin(h.q * 0.7 + h.r * 0.33) + Math.sin(h.r * 0.55 - h.q * 0.21) + Math.cos((h.q + h.r) * 0.41)) / 3;
    const jitter = (rng() - 0.5) * 0.12;
    const n = noise * 0.12 + jitter * 0.5;
    const distNorm = h.ring / R;
    const decay = 1 - 0.32 * distNorm;

    h.officeDensity = clamp(profile.office + n, 0.05, 0.98);
    h.residentialDensity = clamp(profile.resi + n * 0.9, 0.05, 0.95);
    h.income = clamp(profile.income + n * 0.8, 0.1, 0.95);
    h.transitAccess = h.isHub ? clamp(0.88 + jitter, 0.75, 0.97) : clamp(profile.transit + n, 0.1, 0.9);
    h.popDensity = clamp(profile.pop * decay + n * 0.6, 0.08, 1);

    h.population = Math.round(h.popDensity * 40000 + 6500 + jitter * 9000);
    const workingRatio = clamp(0.44 + h.officeDensity * 0.26 + h.residentialDensity * 0.04, 0.4, 0.8);
    h.workingPopulation = Math.round(h.population * workingRatio);
    h.mobilePopulation = Math.round(h.workingPopulation * (0.79 + jitter * 0.5));

    h.homeDistance = clamp(6.2 + h.residentialDensity * 7.2 + h.income * 4.3 + distNorm * 5 + jitter * 4.5, 3.2, 27);
    h.congestion = clamp(h.officeDensity * 0.6 + 0.18 + jitter * 0.35, 0.15, 0.9);
    const speed = clamp(29 - h.congestion * 15, 9, 27);
    h.tripDuration = Math.round((h.homeDistance / speed) * 60);
    h.waitTime = clamp(11.2 - h.officeDensity * 2.1 - h.transitAccess * 1.6 + distNorm * 3.4 + jitter * 2.8, 4, 16.5);
    h.dailyTrips = clamp(1.55 + h.officeDensity * 0.95 + jitter * 0.7, 1.3, 3.7);

    h.taxiProbBase = clamp(0.095 + h.income * 0.145 + (h.homeDistance / 27) * 0.075 - h.transitAccess * 0.06 + h.officeDensity * 0.05 + jitter * 0.05, 0.04, 0.36);

    h.type = h.isHub ? "hub" : h.officeDensity > 0.58 && h.officeDensity >= h.residentialDensity ? "cbd" : h.residentialDensity > 0.55 ? "residential" : "mixed";

    const ageBase = {
      cbd: [14, 35, 28, 14, 6, 3], hub: [16, 32, 26, 15, 7, 4],
      residential: [10, 22, 25, 22, 13, 8], mixed: [12, 26, 26, 19, 11, 6],
    }[h.type];
    let ages = ageBase.map((v) => Math.max(2, v + (rng() - 0.5) * 6));
    const ageSum = ages.reduce((a, b) => a + b, 0);
    ages = ages.map((v) => Math.round((v / ageSum) * 1000) / 10);
    const diff = Math.round((100 - ages.reduce((a, b) => a + b, 0)) * 10) / 10;
    ages[1] = Math.round((ages[1] + diff) * 10) / 10;
    h.ageDistribution = {};
    AGE_KEYS.forEach((k, i) => (h.ageDistribution[k] = ages[i]));

    const male = clamp(50 + jitter * 22, 45, 56);
    h.genderDistribution = { male: Math.round(male * 10) / 10, female: Math.round((100 - male) * 10) / 10 };

    let A = clamp(h.income * 38 + 8 + jitter * 20, 6, 62);
    let B = clamp(58 - Math.abs(h.income - 0.5) * 22 + jitter * 16, 22, 66);
    let C = 100 - A - B;
    if (C < 4) { const deficit = 4 - C; A -= deficit * 0.5; B -= deficit * 0.5; C = 4; }
    const s = A + B + C;
    A = Math.round((A / s) * 1000) / 10; B = Math.round((B / s) * 1000) / 10; C = Math.round((100 - A - B) * 10) / 10;
    h.socioeconomic = { A, B, C };
    h.socioSegmentLabel = A >= 38 ? "A" : A >= 24 ? "B+" : B >= 44 ? "B" : "C";
  });

  return hexes;
}

const HOUR_PARAMS = {
  cbd: { peak: 17.5, sigma: 1.5, amp: 1.05, trough: 0.28 },
  hub: { peak: 18, sigma: 1.3, amp: 1.0, trough: 0.32, morningPeak: 8, morningSigma: 1.1, morningAmp: 0.55 },
  residential: { peak: 18.5, sigma: 2.0, amp: 0.68, trough: 0.3 },
  mixed: { peak: 18, sigma: 2.2, amp: 0.6, trough: 0.3 },
};

function hourMultiplier(type, hour, period) {
  const p = HOUR_PARAMS[type];
  let peak = p.peak, amp = p.amp;
  if (period === "Weekend") {
    amp *= type === "cbd" || type === "hub" ? 0.55 : 0.85;
    peak += 1.3;
  }
  let g = p.trough + amp * Math.exp(-((hour - peak) ** 2) / (2 * p.sigma ** 2));
  if (type === "hub" && period !== "Weekend") {
    g += p.morningAmp * Math.exp(-((hour - p.morningPeak) ** 2) / (2 * p.morningSigma ** 2));
  }
  return g;
}
const refMultiplier = (type) => hourMultiplier(type, 17, "Weekday");

/* Distributions & driver helpers */
function shapedHistogram(mean, buckets, centers, sigma) {
  let weights = centers.map((c) => Math.exp(-((c - mean) ** 2) / (2 * sigma ** 2)));
  const s = weights.reduce((a, b) => a + b, 0);
  weights = weights.map((w) => Math.round((w / s) * 1000) / 10);
  return buckets.map((b, i) => ({ bucket: b, pct: weights[i] }));
}
const distanceHistogram = (mean) => shapedHistogram(mean, ["0–5 km", "5–10 km", "10–15 km", "15–20 km", "20+ km"], [2.5, 7.5, 12.5, 17.5, 23], 6.2);
const durationHistogram = (mean) => shapedHistogram(mean, ["<20 min", "20–30", "30–45", "45–60", "60+"], [15, 25, 37.5, 52.5, 70], 15);

function modePropensity(h) {
  const taxi = 6 + h.taxiProbBase * 55;
  const rideHailing = 16 + h.officeDensity * 8 - h.transitAccess * 4;
  const motorcycle = 42 - h.income * 18 + h.residentialDensity * 6;
  const car = 10 + h.income * 14 - h.transitAccess * 3;
  const publicTransport = 8 + h.transitAccess * 22;
  const other = 6;
  let vals = [taxi, car, motorcycle, publicTransport, rideHailing, other].map((v) => Math.max(2, v));
  const s = vals.reduce((a, b) => a + b, 0);
  vals = vals.map((v) => Math.round((v / s) * 1000) / 10);
  return [
    { label: "Taxi", value: vals[0], key: "taxi" },
    { label: "Private car", value: vals[1], key: "car" },
    { label: "Motorcycle", value: vals[2], key: "motorcycle" },
    { label: "Public transport", value: vals[3], key: "public" },
    { label: "Ride-hailing", value: vals[4], key: "ridehail" },
    { label: "Other", value: vals[5], key: "other" },
  ];
}

function computeDrivers(h, avg) {
  const items = [
    { label: "Longer homebound distance", value: (h.homeDistance - avg.homeDistance) / avg.homeDistance },
    { label: "Higher disposable income", value: (h.income - avg.income) / avg.income },
    { label: "Office-worker concentration", value: (h.officeDensity - avg.officeDensity) / avg.officeDensity },
    { label: "Low public-transit accessibility", value: (avg.transitAccess - h.transitAccess) / avg.transitAccess },
    { label: "Peak-hour congestion", value: (h.congestion - avg.congestion) / avg.congestion },
  ];
  return items.map((it) => ({ ...it, pct: Math.round(it.value * 45) })).sort((a, b) => b.pct - a.pct);
}

function generateDescription(h, avg) {
  let level;
  if (h.demandIndex >= 130) level = "high-potential taxi demand zone";
  else if (h.demandIndex >= 100) level = "above-average taxi demand zone";
  else level = "moderate taxi demand zone";
  const drivers = [];
  if (h.residentialDensity > 0.6) drivers.push("dense residential population");
  if (h.income > 0.65) drivers.push("above-average household income");
  if (h.officeDensity > 0.65) drivers.push("concentrated office activity");
  if (h.homeDistance > avg.homeDistance * 1.1) drivers.push("relatively long homebound trips");
  if (h.transitAccess < 0.4) drivers.push("limited public transit access");
  const driverText = drivers.length ? drivers.slice(0, 3).join(", ") : "typical mobility characteristics for the area";
  return `A ${level} driven by ${driverText}.`;
}

function recommendation(h, percentile) {
  if (percentile >= 90) return { level: "Very High Priority", tone: "red", text: `This zone ranks in the top ${Math.max(1, 100 - percentile)}% of Jakarta analysis areas for potential taxi demand. Strongly consider prioritising fleet allocation here during the 16:30–18:30 homebound window.` };
  if (h.demandIndex >= 115) return { level: "High Priority", tone: "amber", text: `Estimated taxi demand is ${Math.round(h.demandIndex - 100)}% above the Jakarta average during the selected homebound period. Consider increasing fleet availability within this zone between 16:30–18:30.` };
  if (h.demandIndex >= 95) return { level: "Normal Priority", tone: "blue", text: "Estimated taxi demand is close to the Jakarta average. No significant additional fleet positioning requirement is indicated." };
  return { level: "Low Priority", tone: "slate", text: "Estimated taxi demand is below the Jakarta average. Standard fleet allocation is likely sufficient for this zone." };
}

/* ============================================================
   HEX GEOMETRY
   ============================================================ */
function hexPoints(cx, cy, size) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    pts.push(`${cx + size * Math.cos(angle)},${cy + size * Math.sin(angle)}`);
  }
  return pts.join(" ");
}

const DEMAND_COLORS = ["#334155", "#1d4ed8", "#0ea5e9", "#f59e0b", "#dc2626"];

function quantileThresholds(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const q = (p) => {
    const pos = (sorted.length - 1) * p;
    const base = Math.floor(pos), rest = pos - base;
    return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
  };
  return [sorted[0], q(0.2), q(0.4), q(0.6), q(0.8), sorted[sorted.length - 1]];
}
function bucketIndex(v, th) {
  if (v <= th[1]) return 0;
  if (v <= th[2]) return 1;
  if (v <= th[3]) return 2;
  if (v <= th[4]) return 3;
  return 4;
}

/* ============================================================
   SMALL UI PRIMITIVES
   ============================================================ */
function KPICard({ label, value, sub, delta, deltaLabel, icon: Icon }) {
  const positive = delta !== undefined && delta >= 0;
  return (
    <div className="bg-white border border-slate-200 rounded-md px-4 py-3 flex flex-col gap-1 min-w-0 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wider text-slate-9000 font-medium">{label}</span>
        {Icon && <Icon size={13} className="text-slate-9000" />}
      </div>
      <div className="text-2xl font-semibold text-slate-900 tabular-nums leading-tight">{value}</div>
      {delta !== undefined ? (
        <div className={`flex items-center gap-1 text-[11px] font-medium ${positive ? "text-emerald-600" : "text-red-600"}`}>
          {positive ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
          <span>{deltaLabel}</span>
        </div>
      ) : (
        <span className="text-[11px] text-slate-9000">{sub}</span>
      )}
    </div>
  );
}

function SectionTitle({ children, right }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <h3 className="text-[12px] font-semibold uppercase tracking-wider text-slate-700">{children}</h3>
      {right}
    </div>
  );
}

function Panel({ children, className = "" }) {
  return <div className={`bg-white border border-slate-200 rounded-md p-4 shadow-sm ${className}`}>{children}</div>;
}

function ComparisonBar({ label, value, max, color = "#2563eb", format = formatInt }) {
  const pct = clamp((value / max) * 100, 2, 100);
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] text-slate-9000 w-28 shrink-0">{label}</span>
      <div className="flex-1 h-4 bg-slate-100 rounded-sm overflow-hidden">
        <div className="h-full rounded-sm transition-all duration-500" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[12px] text-slate-700 font-medium tabular-nums w-16 text-right">{format(value)}</span>
    </div>
  );
}

function DistBar({ rows, compareRows, unit = "%" }) {
  const max = Math.max(...rows.map((r) => r.pct), compareRows ? Math.max(...compareRows.map((r) => r.pct)) : 0, 1);
  return (
    <div className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <div key={r.bucket} className="flex items-center gap-2.5">
          <span className="text-[11px] text-slate-500 w-16 shrink-0">{r.bucket}</span>
          <div className="flex-1 relative h-3.5">
            <div className="absolute inset-y-0 left-0 bg-indigo-600 rounded-sm" style={{ width: `${(r.pct / max) * 100}%` }} />
            {compareRows && (
              <div className="absolute top-full mt-0.5 h-[3px] bg-slate-500 rounded-sm" style={{ width: `${(compareRows[i].pct / max) * 100}%` }} />
            )}
          </div>
          <span className="text-[11px] text-slate-700 tabular-nums w-10 text-right">{r.pct}{unit}</span>
        </div>
      ))}
      {compareRows && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-9000 mt-0.5">
          <span className="w-2.5 h-2.5 bg-indigo-600 rounded-sm inline-block" /> Selected area
          <span className="w-2.5 h-1 bg-slate-500 rounded-sm inline-block ml-3" /> Jakarta average
        </div>
      )}
    </div>
  );
}

/* ============================================================
   MAP COMPONENT
   ============================================================ */
function MapView({
  hexes, selectedId, onSelect, hoveredId, setHoveredId, layers,
  bounds, view, setView, tooltipPos, setTooltipPos,
}) {
  const containerRef = useRef(null);
  const dragRef = useRef(null);

  const values = hexes.map((h) => h.potentialTaxiUsers);
  const thresholds = useMemo(() => quantileThresholds(values), [hexes]);

  // Jakarta-area geographic extent. Hex coordinates are mapped into this
  // extent so the analytical grid sits directly over the OSM basemap.
  const GEO = { west: 106.62, east: 107.08, north: -6.05, south: -6.48 };

  const onMouseDown = (e) => {
    if (e.button !== 0) return;
    dragRef.current = { startX: e.clientX, startY: e.clientY, tx: view.tx, ty: view.ty };
  };

  const onMouseMove = (e) => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setTooltipPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    if (dragRef.current) {
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setView((v) => ({ ...v, tx: dragRef.current.tx + dx, ty: dragRef.current.ty + dy }));
    }
  };

  const onMouseUp = () => { dragRef.current = null; };

  const zoomIn = () => setView((v) => ({ ...v, scale: clamp(v.scale * 1.25, 0.7, 3.5) }));
  const zoomOut = () => setView((v) => ({ ...v, scale: clamp(v.scale / 1.25, 0.7, 3.5) }));
  const reset = () => setView({ scale: 1, tx: 0, ty: 0 });

  const w = bounds.maxX - bounds.minX, h2 = bounds.maxY - bounds.minY;
  const vb = `${bounds.minX} ${bounds.minY} ${w} ${h2}`;
  const hovered = hexes.find((x) => x.id === hoveredId);

  // Keep the basemap and SVG in exactly the same local coordinate system.
  // OSM is displayed as a tile mosaic underneath; the analytical SVG is
  // projected over the same Jakarta bounding box.
  const tileZoom = 11;
  const tileSize = 256;

  const lon2x = (lon) => ((lon - GEO.west) / (GEO.east - GEO.west)) * w + bounds.minX;
  const lat2y = (lat) => ((GEO.north - lat) / (GEO.north - GEO.south)) * h2 + bounds.minY;

  // Web Mercator tile conversion for a lightweight OSM tile mosaic.
  const lonToWorldX = (lon, z) => ((lon + 180) / 360) * Math.pow(2, z) * tileSize;
  const latToWorldY = (lat, z) => {
    const rad = (lat * Math.PI) / 180;
    return (1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2 * Math.pow(2, z) * tileSize;
  };

  const centerLon = (GEO.west + GEO.east) / 2;
  const centerLat = (GEO.north + GEO.south) / 2;
  const centerWX = lonToWorldX(centerLon, tileZoom);
  const centerWY = latToWorldY(centerLat, tileZoom);

  const tileSpan = Math.max(w, h2) * 1.35;
  const tileWorldW = tileSpan * 1.15;
  const tileWorldH = tileSpan * 1.15;
  const startWX = centerWX - tileWorldW / 2;
  const startWY = centerWY - tileWorldH / 2;
  const endWX = centerWX + tileWorldW / 2;
  const endWY = centerWY + tileWorldH / 2;
  const minTX = Math.floor(startWX / tileSize) - 1;
  const maxTX = Math.ceil(endWX / tileSize) + 1;
  const minTY = Math.floor(startWY / tileSize) - 1;
  const maxTY = Math.ceil(endWY / tileSize) + 1;
  const tiles = [];

  for (let tx = minTX; tx <= maxTX; tx++) {
    for (let ty = minTY; ty <= maxTY; ty++) {
      const n = Math.pow(2, tileZoom);
      const wrappedX = ((tx % n) + n) % n;
      tiles.push({
        key: `${tx}-${ty}`,
        x: (tx * tileSize - centerWX) / w * w + (w / 2),
        y: (ty * tileSize - centerWY) / h2 * h2 + (h2 / 2),
        src: `https://tile.openstreetmap.org/${tileZoom}/${wrappedX}/${ty}.png`,
      });
    }
  }

  const geoHexes = hexes.map((hx) => {
    // The existing analytical grid is normalized into the Jakarta geographic
    // extent. This keeps the user's existing demand model while aligning it
    // visually with the actual street geography.
    const gx = ((hx.x - bounds.minX) / w);
    const gy = ((hx.y - bounds.minY) / h2);
    return {
      ...hx,
      mapX: bounds.minX + gx * w,
      mapY: bounds.minY + gy * h2,
    };
  });

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden select-none cursor-grab active:cursor-grabbing bg-slate-100"
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
      onMouseLeave={onMouseUp}
    >
      {/* OpenStreetMap basemap */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{ background: "#e8edf2" }}
      >
        <div
          className="absolute"
          style={{
            left: "50%",
            top: "50%",
            width: `${w}px`,
            height: `${h2}px`,
            transform: `translate(-50%, -50%) translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
            transformOrigin: "center center",
          }}
        >
          {tiles.map((tile) => (
            <img
              key={tile.key}
              src={tile.src}
              alt=""
              draggable={false}
              className="absolute pointer-events-none"
              style={{
                left: `${tile.x}px`,
                top: `${tile.y}px`,
                width: `${tileSize}px`,
                height: `${tileSize}px`,
                opacity: 0.92,
              }}
              onError={(e) => { e.currentTarget.style.display = "none"; }}
            />
          ))}
        </div>
        <div className="absolute inset-0 bg-white/10 pointer-events-none" />
      </div>

      {/* Hexagonal demand overlay */}
      <svg
        viewBox={vb}
        className="absolute inset-0 w-full h-full pointer-events-none"
        preserveAspectRatio="xMidYMid meet"
      >
        <g
          transform={`translate(${view.tx} ${view.ty}) scale(${view.scale})`}
          className="pointer-events-auto"
        >
          {layers.hex && geoHexes.map((hx) => {
            const bIdx = bucketIndex(hx.potentialTaxiUsers, thresholds);
            const fill = layers.demand ? DEMAND_COLORS[bIdx] : "#64748b";
            const isSel = hx.id === selectedId;
            const isHov = hx.id === hoveredId;
            return (
              <polygon
                key={hx.id}
                points={hexPoints(hx.mapX, hx.mapY, 15.4)}
                fill={fill}
                fillOpacity={layers.demand ? 0.32 : 0.16}
                stroke={isSel ? "#0f172a" : isHov ? "#f59e0b" : "#ffffff"}
                strokeOpacity={isSel ? 0.95 : 0.58}
                strokeWidth={isSel ? 2 : isHov ? 1.6 : 0.8}
                onMouseEnter={() => setHoveredId(hx.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => onSelect(hx.id)}
                style={{ cursor: "pointer", transition: "fill-opacity 120ms" }}
              />
            );
          })}
        </g>
      </svg>

      {hovered && (
        <div
          className="absolute pointer-events-none bg-white/95 border border-slate-700 rounded-md px-3 py-2 text-[11px] text-slate-100 shadow-xl z-20"
          style={{ left: Math.min(tooltipPos.x + 14, 10000), top: tooltipPos.y + 14, minWidth: 170 }}
        >
          <div className="text-slate-500 mb-0.5">{hovered.district}</div>
          <div className="font-semibold text-white mb-1.5">{hovered.id}</div>
          <div className="flex justify-between gap-4"><span className="text-slate-500">Potential Taxi Users</span><span className="tabular-nums font-medium">{formatInt(hovered.potentialTaxiUsers)}</span></div>
          <div className="flex justify-between gap-4"><span className="text-slate-500">Demand Index</span><span className="tabular-nums font-medium">{hovered.demandIndex}</span></div>
          <div className="flex justify-between gap-4"><span className="text-slate-500">Taxi Probability</span><span className="tabular-nums font-medium">{formatPct(hovered.taxiProbability * 100)}</span></div>
        </div>
      )}

      <div className="absolute top-3 right-3 flex flex-col bg-white/95 border border-slate-200 rounded-md overflow-hidden z-10 shadow-sm">
        <button onClick={zoomIn} className="w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-50 border-b border-slate-200"><ZoomIn size={14} /></button>
        <button onClick={zoomOut} className="w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-50 border-b border-slate-200"><ZoomOut size={14} /></button>
        <button onClick={reset} className="w-8 h-8 flex items-center justify-center text-slate-600 hover:bg-slate-50"><RotateCcw size={13} /></button>
      </div>

      <div className="absolute bottom-3 left-3 bg-white/95 border border-slate-200 rounded-md px-3 py-2.5 z-10 shadow-sm">
        <div className="text-[10px] uppercase tracking-wider text-slate-9000 font-semibold mb-1.5">Estimated Potential Taxi Users</div>
        <div className="flex items-center gap-2.5">
          {DEMAND_COLORS.map((c, i) => (
            <div key={c} className="flex flex-col items-center gap-1">
              <div className="w-5 h-3 rounded-[1px]" style={{ backgroundColor: c, opacity: 0.52 }} />
              <span className="text-[9px] text-slate-9000 tabular-nums whitespace-nowrap">
                {i === 0 ? `<${formatInt(thresholds[1])}` : i === 4 ? `>${formatInt(thresholds[4])}` : `${formatInt(thresholds[i])}–${formatInt(thresholds[i + 1])}`}
              </span>
            </div>
          ))}
        </div>
        <div className="text-[9px] text-slate-500 mt-1.5">Hexagons are semi-transparent to preserve street context.</div>
      </div>

      <div className="absolute bottom-3 right-3 bg-white/90 border border-slate-200 rounded px-2 py-1 text-[9px] text-slate-9000 z-10">
        © OpenStreetMap contributors
      </div>
    </div>
  );
}

/* ============================================================
   MAP CONTROL BAR (layers, style, search)
   ============================================================ */
function MapControlBar({ layers, setLayers, mapStyle, setMapStyle, onSearch, districts }) {
  const [q, setQ] = useState("");
  const [layerOpen, setLayerOpen] = useState(false);
  const toggle = (k) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-200 bg-white flex-wrap">
      <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-md px-2 h-8 w-52">
        <Search size={12} className="text-slate-500 shrink-0" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") onSearch(q); }}
          placeholder="Search district or hex ID"
          className="bg-transparent text-[11px] text-slate-700 placeholder-slate-400 outline-none w-full"
        />
      </div>

      <div className="relative">
        <button onClick={() => setLayerOpen((o) => !o)} className="flex items-center gap-1.5 h-8 px-2.5 bg-white border border-slate-200 rounded-md text-[11px] text-slate-600 hover:border-slate-300">
          <Layers size={12} /> Layers <ChevronDown size={11} />
        </button>
        {layerOpen && (
          <div className="absolute top-9 left-0 bg-white border border-slate-200 rounded-md p-2.5 w-48 z-30 shadow-xl flex flex-col gap-1.5">
            {[
              ["hex", "Hexagon grid"], ["demand", "Demand intensity"], ["transit", "Transit / road layer"], ["poi", "Points of interest"],
            ].map(([k, label]) => (
              <label key={k} className="flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer">
                <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} className="accent-indigo-500" />
                {label}
              </label>
            ))}
          </div>
        )}
      </div>

      <button
        onClick={() => setMapStyle((s) => (s === "dark" ? "neutral" : "dark"))}
        className="flex items-center gap-1.5 h-8 px-2.5 bg-white border border-slate-200 rounded-md text-[11px] text-slate-600 hover:border-slate-300"
      >
        <MapPin size={12} /> OpenStreetMap basemap
      </button>

      <div className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-9000">
        <Info size={11} /> Drag to pan · Click a hexagon to select
      </div>
    </div>
  );
}

/* ============================================================
   HEADER
   ============================================================ */
function Header({ hour, setHour, period, setPeriod }) {
  const hours = [6, 8, 10, 12, 14, 16, 17, 18, 20, 22];
  return (
    <header className="flex items-center justify-between px-5 py-3 border-b border-slate-200 bg-white shrink-0">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-md bg-indigo-600 flex items-center justify-center shrink-0">
          <Navigation size={16} className="text-white" strokeWidth={2.2} />
        </div>
        <div className="leading-tight">
          <div className="text-[15px] font-semibold text-slate-900 tracking-tight">Delta Mobility</div>
          <div className="text-[10.5px] text-slate-9000 -mt-0.5">Mobility Intelligence Platform</div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2.5 h-8">
          <MapPin size={11} className="text-slate-500" /> Jakarta
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2.5 h-8">
          <Clock size={11} className="text-slate-500" />
          <select value={hour} onChange={(e) => setHour(Number(e.target.value))} className="bg-transparent outline-none cursor-pointer">
            {hours.map((h) => <option key={h} value={h}>{String(h).padStart(2, "0")}:00</option>)}
          </select>
        </div>
        <div className="flex items-center bg-slate-50 border border-slate-200 rounded-md h-8 overflow-hidden text-[11px]">
          {["Weekday", "Weekend"].map((p) => (
            <button key={p} onClick={() => setPeriod(p)} className={`px-2.5 h-full ${period === p ? "bg-indigo-600 text-white" : "text-slate-9000 hover:text-slate-800"}`}>{p}</button>
          ))}
        </div>
        <div className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-md px-2.5 h-8 flex items-center">
          12 Aug 2026
        </div>
        <div className="flex items-center gap-1.5 text-[10.5px] text-slate-9000 pl-2 border-l border-slate-200 ml-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block" /> Mobility data simulated
        </div>
        <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-[10px] text-slate-600 font-medium ml-1">RA</div>
      </div>
    </header>
  );
}

/* ============================================================
   TABS
   ============================================================ */
function Tabs({ active, setActive }) {
  const tabs = [
    { id: "overview", label: "Overview", icon: TrendingUp },
    { id: "mobility", label: "Mobility", icon: Navigation },
    { id: "demographics", label: "Demographics", icon: Users },
  ];

  return (
    <aside className="w-[210px] shrink-0 bg-white text-slate-700 border-r border-slate-200 flex flex-col">
      <div className="px-4 pt-5 pb-3">
        <div className="text-[9px] uppercase tracking-[0.18em] text-slate-9000 font-semibold">Workspace</div>
        <div className="text-[11px] text-slate-500 mt-1">Jakarta Mobility Intelligence</div>
      </div>
      <nav className="px-2.5 space-y-1">
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              onClick={() => setActive(t.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left text-[12px] font-medium transition-colors ${
                active === t.id
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-slate-500 hover:text-slate-100 hover:bg-white"
              }`}
            >
              <Icon size={15} />
              <span>{t.label}</span>
              {active === t.id && <ChevronRight size={13} className="ml-auto opacity-80" />}
            </button>
          );
        })}
      </nav>

      <div className="mt-auto p-3">
        <div className="border border-slate-800 rounded-md p-3 bg-slate-900/70">
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-wider text-slate-9000 font-semibold">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
            Data environment
          </div>
          <div className="text-[11px] text-slate-700 mt-1.5">Simulated mobility data</div>
          <div className="text-[9.5px] text-slate-9000 mt-1 leading-relaxed">Area-level analytics for demonstration only.</div>
        </div>
      </div>
    </aside>
  );
}

function SelectionBar({ hex, onClear }) {
  if (!hex) {
    return (
      <div className="flex items-center gap-2 px-5 py-2 bg-indigo-50 border-b border-indigo-100 text-[11.5px] text-indigo-700">
        <Info size={13} /> Select a hexagon on the map to explore local mobility intelligence.
      </div>
    );
  }
  return (
    <div className="flex items-center justify-between px-5 py-2 bg-white border-b border-slate-200 text-[11.5px]">
      <div className="flex items-center gap-2 text-slate-600">
        <MapPin size={12} className="text-indigo-400" />
        <span className="font-semibold text-slate-800">{hex.id}</span>
        <span className="text-slate-9000">·</span>
        <span>{hex.district}</span>
        <span className="text-slate-9000">·</span>
        <span className="text-slate-500">Segment {hex.socioSegmentLabel}</span>
      </div>
      <button onClick={onClear} className="flex items-center gap-1 text-slate-9000 hover:text-slate-700"><X size={12} /> Clear selection</button>
    </div>
  );
}

/* ============================================================
   OVERVIEW TAB
   ============================================================ */
function TrendChart({ hex, period, hour, setHour }) {
  const hours = [6, 8, 10, 12, 14, 16, 17, 18, 20, 22];
  const data = hours.map((hr) => {
    const mult = hex ? hourMultiplier(hex.type, hr, period) / refMultiplier(hex.type) : hourMultiplier("mixed", hr, period) / refMultiplier("mixed");
    const value = hex ? Math.round(hex.mobilePopulation * hex.taxiProbBase * mult) : Math.round(600000 * mult);
    return { hour: `${String(hr).padStart(2, "0")}:00`, hourNum: hr, value };
  });
  return (
    <div>
      <ResponsiveContainer width="100%" height={130}>
        <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#e2e8f0" vertical={false} />
          <XAxis dataKey="hour" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={{ stroke: "#cbd5e1" }} tickLine={false} />
          <YAxis tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} tickFormatter={(v) => formatNumber(v)} width={40} />
          <RTooltip
            contentStyle={{ background: "#ffffff", border: "1px solid #cbd5e1", fontSize: 11, borderRadius: 6, color: "#334155" }}
            labelStyle={{ color: "#334155" }}
            formatter={(v) => [formatInt(v), "Potential taxi users"]}
          />
          <ReferenceLine x={`${String(hour).padStart(2, "0")}:00`} stroke="#f59e0b" strokeDasharray="3 3" />
          <Line type="monotone" dataKey="value" stroke="#6366f1" strokeWidth={2} dot={{ r: 2.5, fill: "#6366f1" }} activeDot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-1.5 text-[10.5px] text-amber-400 mt-1">
        <Clock size={11} /> {hour}:00 — {hour === 17 ? "Peak homebound period" : hour > 17 && hour <= 19 ? "Homebound period" : "Off-peak period"}
      </div>
    </div>
  );
}

function RankingTable({ ranked, selectedId, onSelect }) {
  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[24px_1fr_70px_50px_54px] gap-2 px-1 pb-1.5 text-[10px] uppercase tracking-wider text-slate-9000 border-b border-slate-200">
        <span>#</span><span>Area</span><span className="text-right">Users</span><span className="text-right">Index</span><span className="text-right">P(taxi)</span>
      </div>
      {ranked.map((h, i) => (
        <button
          key={h.id}
          onClick={() => onSelect(h.id)}
          className={`grid grid-cols-[24px_1fr_70px_50px_54px] gap-2 px-1 py-1.5 text-[11px] text-left border-b border-slate-200 hover:bg-slate-50 ${selectedId === h.id ? "bg-indigo-950/50" : ""}`}
        >
          <span className="text-slate-9000 tabular-nums">{i + 1}</span>
          <span className="text-slate-700 truncate">{h.id}</span>
          <span className="text-slate-200 text-right tabular-nums">{formatInt(h.potentialTaxiUsers)}</span>
          <span className="text-slate-500 text-right tabular-nums">{h.demandIndex}</span>
          <span className="text-slate-500 text-right tabular-nums">{formatPct(h.taxiProbability * 100)}</span>
        </button>
      ))}
    </div>
  );
}

/* ============================================================
   MOBILITY TAB
   ============================================================ */
function MobilityTab({ hex, cityAvg }) {
  if (!hex) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-9000 text-[13px]">
        <div className="flex flex-col items-center gap-2">
          <Info size={18} />
          Select a hexagon on the Overview map to view mobility characteristics.
        </div>
      </div>
    );
  }
  const distHist = distanceHistogram(hex.homeDistance);
  const cityDistHist = distanceHistogram(cityAvg.homeDistance);
  const durHist = durationHistogram(hex.tripDuration);
  const cityDurHist = durationHistogram(cityAvg.tripDuration);
  const modes = modePropensity(hex);
  const drivers = computeDrivers(hex, cityAvg);

  return (
    <div className="p-4 grid grid-cols-3 gap-3 overflow-y-auto">
      <div className="col-span-3 grid grid-cols-6 gap-3">
        <KPICard label="Avg. Taxi Waiting Time" value={formatMin(hex.waitTime)} sub={`Jakarta avg: ${formatMin(cityAvg.waitTime)}`} icon={Clock} />
        <KPICard label="Avg. Home Distance" value={formatKm(hex.homeDistance)} sub={`Jakarta avg: ${formatKm(cityAvg.homeDistance)}`} icon={Navigation} />
        <KPICard label="Avg. Homebound Duration" value={formatMin(hex.tripDuration)} sub={`Jakarta avg: ${formatMin(cityAvg.tripDuration)}`} icon={Clock} />
        <KPICard label="Taxi Probability" value={formatPct(hex.taxiProbability * 100)} sub={`Jakarta avg: ${formatPct(cityAvg.taxiProbability * 100)}`} icon={Car} />
        <KPICard label="Avg. Daily Trips" value={hex.dailyTrips.toFixed(1) + "/person"} sub={`Jakarta avg: ${cityAvg.dailyTrips.toFixed(1)}/person`} icon={Users} />
        <KPICard label="Peak Mobility Window" value="16:30–18:30" sub="Homebound egress window" icon={Clock} />
      </div>

      <Panel>
        <SectionTitle>Homebound Distance Distribution</SectionTitle>
        <DistBar rows={distHist} compareRows={cityDistHist} />
      </Panel>

      <Panel>
        <SectionTitle>Homebound Trip Duration</SectionTitle>
        <DistBar rows={durHist} compareRows={cityDurHist} />
      </Panel>

      <Panel>
        <SectionTitle>Mode Propensity</SectionTitle>
        <div className="flex flex-col gap-2">
          {modes.sort((a, b) => b.value - a.value).map((m) => (
            <div key={m.key} className="flex items-center gap-2.5">
              <span className="text-[11px] text-slate-9000 w-28 shrink-0">{m.label}</span>
              <div className="flex-1 h-3.5 bg-slate-100 rounded-sm overflow-hidden">
                <div className="h-full rounded-sm" style={{ width: `${m.value}%`, backgroundColor: m.key === "taxi" ? "#6366f1" : "#475569" }} />
              </div>
              <span className="text-[11px] text-slate-200 tabular-nums w-10 text-right">{m.value}%</span>
            </div>
          ))}
        </div>
      </Panel>

      <Panel className="col-span-3">
        <SectionTitle>What Is Driving Taxi Demand?</SectionTitle>
        <div className="flex flex-col gap-2.5">
          {drivers.map((d) => (
            <div key={d.label} className="flex items-center gap-3">
              <span className="text-[11.5px] text-slate-700 w-56 shrink-0">{d.label}</span>
              <div className="flex-1 h-4 bg-slate-800 rounded-sm relative overflow-hidden">
                <div
                  className="h-full rounded-sm"
                  style={{ width: `${Math.min(100, Math.abs(d.pct) * 2.2)}%`, backgroundColor: d.pct >= 0 ? "#6366f1" : "#dc2626", marginLeft: d.pct >= 0 ? 0 : "auto" }}
                />
              </div>
              <span className={`text-[11.5px] font-medium tabular-nums w-12 text-right ${d.pct >= 0 ? "text-emerald-400" : "text-red-400"}`}>{formatSigned(d.pct, 0)}</span>
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

/* ============================================================
   DEMOGRAPHICS TAB
   ============================================================ */
function DemographicsTab({ hex, cityAvg }) {
  if (!hex) {
    return (
      <div className="flex-1 flex items-center justify-center text-slate-9000 text-[13px]">
        <div className="flex flex-col items-center gap-2">
          <Info size={18} />
          Select a hexagon on the Overview map to view demographic characteristics.
        </div>
      </div>
    );
  }

  const ageRows = AGE_KEYS.map((k) => ({ segment: AGE_LABELS[k], selected: hex.ageDistribution[k], jakarta: cityAvg.ageDistribution[k] }));
  const ratio = hex.taxiProbBase / cityAvg.taxiProbBase;
  const agePropensity = AGE_KEYS.map((k) => ({ segment: AGE_LABELS[k], value: clamp(Math.round(AGE_BASE_PROPENSITY[k] * ratio * 10) / 10, 3, 45) }));
  const socioPropensity = ["A", "B", "C"].map((k) => ({ segment: k, value: clamp(Math.round(SOCIO_BASE_PROPENSITY[k] * ratio * 10) / 10, 3, 45) }));

  return (
    <div className="p-4 grid grid-cols-3 gap-3 overflow-y-auto">
      <div className="col-span-3 grid grid-cols-3 gap-3">
        <KPICard label="Estimated Population" value={formatInt(hex.population)} sub="Area-level aggregate estimate" icon={Users} />
        <KPICard label="Estimated Working Population" value={formatInt(hex.workingPopulation)} sub={`${Math.round((hex.workingPopulation / hex.population) * 100)}% of population`} icon={Building2} />
        <KPICard label="Estimated Mobile Population" value={formatInt(hex.mobilePopulation)} sub="Commutes on a typical weekday" icon={Navigation} />
      </div>

      <Panel>
        <SectionTitle>Age Distribution</SectionTitle>
        <div className="flex flex-col gap-2">
          {ageRows.map((r) => (
            <div key={r.segment} className="flex items-center gap-2.5">
              <span className="text-[11px] text-slate-500 w-14 shrink-0">{r.segment}</span>
              <div className="flex-1 relative h-3.5">
                <div className="absolute inset-y-0 left-0 bg-indigo-600 rounded-sm" style={{ width: `${r.selected * 2.2}%` }} />
                <div className="absolute top-full mt-0.5 h-[3px] bg-slate-500 rounded-sm" style={{ width: `${r.jakarta * 2.2}%` }} />
              </div>
              <span className="text-[11px] text-slate-700 tabular-nums w-10 text-right">{r.selected}%</span>
            </div>
          ))}
          <div className="flex items-center gap-1.5 text-[10px] text-slate-9000 mt-1">
            <span className="w-2.5 h-2.5 bg-indigo-600 rounded-sm inline-block" /> Selected area
            <span className="w-2.5 h-1 bg-slate-500 rounded-sm inline-block ml-3" /> Jakarta average
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionTitle>Gender Distribution</SectionTitle>
        <div className="flex items-center gap-6 justify-center py-2">
          <div className="flex flex-col items-center">
            <div className="text-2xl font-semibold text-indigo-400 tabular-nums">{hex.genderDistribution.male}%</div>
            <div className="text-[11px] text-slate-9000">Male</div>
          </div>
          <div className="w-px h-10 bg-slate-800" />
          <div className="flex flex-col items-center">
            <div className="text-2xl font-semibold text-slate-700 tabular-nums">{hex.genderDistribution.female}%</div>
            <div className="text-[11px] text-slate-9000">Female</div>
          </div>
        </div>
        <div className="flex h-3 rounded-sm overflow-hidden mt-1">
          <div style={{ width: `${hex.genderDistribution.male}%` }} className="bg-indigo-600" />
          <div style={{ width: `${hex.genderDistribution.female}%` }} className="bg-slate-600" />
        </div>
      </Panel>

      <Panel>
        <div className="flex items-center gap-1.5 mb-2.5">
          <h3 className="text-[12px] font-semibold uppercase tracking-wider text-slate-700">Socioeconomic Distribution</h3>
          <div className="group relative">
            <Info size={11} className="text-slate-9000 cursor-help" />
            <div className="hidden group-hover:block absolute left-0 top-5 w-56 bg-white border border-slate-700 rounded-sm p-2 text-[10px] text-slate-500 z-20 leading-relaxed">
              Socioeconomic classification is an estimated analytical segmentation based on mock demographic and economic indicators. It does not represent individual income records.
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-2 mb-2.5">
          {["A", "B", "C"].map((k) => (
            <div key={k} className="flex items-center gap-2.5">
              <span className="text-[11px] text-slate-500 w-24 shrink-0">Segment {k}</span>
              <div className="flex-1 h-3.5 bg-slate-100 rounded-sm overflow-hidden">
                <div className="h-full rounded-sm" style={{ width: `${hex.socioeconomic[k]}%`, backgroundColor: k === "A" ? "#6366f1" : k === "B" ? "#0ea5e9" : "#64748b" }} />
              </div>
              <span className="text-[11px] text-slate-700 tabular-nums w-10 text-right">{hex.socioeconomic[k]}%</span>
            </div>
          ))}
        </div>
        <div className="border-t border-slate-200 pt-2 flex items-center justify-between">
          <span className="text-[11px] text-slate-9000">Average socioeconomic segment</span>
          <span className="text-[13px] font-semibold text-slate-800">{hex.socioSegmentLabel}</span>
        </div>
      </Panel>

      <Panel className="col-span-2">
        <SectionTitle>Taxi Propensity by Demographic Segment</SectionTitle>
        <div className="grid grid-cols-2 gap-x-6">
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-9000 mb-0.5">By age group</div>
            <table className="w-full text-[11.5px]">
              <tbody>
                {agePropensity.map((r) => (
                  <tr key={r.segment} className="border-b border-slate-200">
                    <td className="py-1 text-slate-500">{r.segment}</td>
                    <td className="py-1 text-right text-slate-100 tabular-nums font-medium">{formatPct(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-1.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-9000 mb-0.5">By socioeconomic segment</div>
            <table className="w-full text-[11.5px]">
              <tbody>
                {socioPropensity.map((r) => (
                  <tr key={r.segment} className="border-b border-slate-200">
                    <td className="py-1 text-slate-500">Segment {r.segment}</td>
                    <td className="py-1 text-right text-slate-100 tabular-nums font-medium">{formatPct(r.value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </Panel>

      <Panel className="col-span-3 flex items-start gap-2">
        <AlertCircle size={13} className="text-slate-9000 mt-0.5 shrink-0" />
        <p className="text-[10.5px] text-slate-9000 leading-relaxed">Demographic characteristics shown are aggregated, area-level estimates derived from simulated data. They do not represent identifiable individuals or their movements.</p>
      </Panel>
    </div>
  );
}

/* ============================================================
   ROOT APP
   ============================================================ */
export default function DeltaMobility() {
  const [hexesBase] = useState(() => generateHexGrid(42));
  const [selectedId, setSelectedId] = useState(null);
  const [activeTab, setActiveTab] = useState("overview");
  const [hour, setHour] = useState(17);
  const [period, setPeriod] = useState("Weekday");
  const [comparisonMode, setComparisonMode] = useState("jakarta");
  const [hoveredId, setHoveredId] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [layers, setLayers] = useState({ hex: true, demand: true, transit: true, poi: false });
  const [mapStyle, setMapStyle] = useState("neutral");
  const [view, setView] = useState({ scale: 1, tx: 0, ty: 0 });

  const bounds = useMemo(() => {
    const xs = hexesBase.map((h) => h.x), ys = hexesBase.map((h) => h.y);
    const pad = 34;
    return { minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minY: Math.min(...ys) - pad, maxY: Math.max(...ys) + pad };
  }, [hexesBase]);

  const liveHexes = useMemo(() => {
    const withTaxi = hexesBase.map((h) => {
      const mult = hourMultiplier(h.type, hour, period) / refMultiplier(h.type);
      const potentialTaxiUsers = Math.round(h.mobilePopulation * h.taxiProbBase * mult);
      const taxiProbability = clamp(h.taxiProbBase * (0.88 + mult * 0.12), 0.03, 0.4);
      return { ...h, potentialTaxiUsers, taxiProbability };
    });
    const avgUsers = withTaxi.reduce((a, b) => a + b.potentialTaxiUsers, 0) / withTaxi.length;
    return withTaxi.map((h) => ({ ...h, demandIndex: Math.round((100 * h.potentialTaxiUsers) / avgUsers) }));
  }, [hexesBase, hour, period]);

  const cityAvg = useMemo(() => {
    const n = liveHexes.length;
    const sum = (fn) => liveHexes.reduce((a, h) => a + fn(h), 0) / n;
    const ageDistribution = {};
    AGE_KEYS.forEach((k) => (ageDistribution[k] = Math.round(sum((h) => h.ageDistribution[k]) * 10) / 10));
    return {
      potentialTaxiUsers: sum((h) => h.potentialTaxiUsers),
      totalPotentialTaxiUsers: liveHexes.reduce((a, h) => a + h.potentialTaxiUsers, 0),
      demandIndex: 100,
      taxiProbability: sum((h) => h.taxiProbability),
      homeDistance: sum((h) => h.homeDistance),
      waitTime: sum((h) => h.waitTime),
      tripDuration: sum((h) => h.tripDuration),
      dailyTrips: sum((h) => h.dailyTrips),
      income: sum((h) => h.income),
      officeDensity: sum((h) => h.officeDensity),
      transitAccess: sum((h) => h.transitAccess),
      congestion: sum((h) => h.congestion),
      ageDistribution,
    };
  }, [liveHexes]);

  const selectedHex = liveHexes.find((h) => h.id === selectedId) || null;

  const ranked = useMemo(() => [...liveHexes].sort((a, b) => b.potentialTaxiUsers - a.potentialTaxiUsers), [liveHexes]);

  const percentile = useMemo(() => {
    if (!selectedHex) return 0;
    const rankIdx = ranked.findIndex((h) => h.id === selectedHex.id);
    return Math.round(((ranked.length - rankIdx) / ranked.length) * 100);
  }, [ranked, selectedHex]);

  const nearbyAvg = useMemo(() => {
    if (!selectedHex) return cityAvg;
    const near = liveHexes.filter((h) => h.id !== selectedHex.id && Math.hypot(h.x - selectedHex.x, h.y - selectedHex.y) < 60);
    if (near.length === 0) return cityAvg;
    const n = near.length;
    const sum = (fn) => near.reduce((a, h) => a + fn(h), 0) / n;
    return {
      potentialTaxiUsers: sum((h) => h.potentialTaxiUsers),
      taxiProbability: sum((h) => h.taxiProbability),
      homeDistance: sum((h) => h.homeDistance),
      waitTime: sum((h) => h.waitTime),
      tripDuration: sum((h) => h.tripDuration),
    };
  }, [liveHexes, selectedHex, cityAvg]);

  const handleSearch = useCallback((q) => {
    if (!q.trim()) return;
    const query = q.trim().toLowerCase();
    let match = liveHexes.find((h) => h.id.toLowerCase() === query);
    if (!match) match = liveHexes.filter((h) => h.district.toLowerCase().includes(query)).sort((a, b) => b.potentialTaxiUsers - a.potentialTaxiUsers)[0];
    if (match) {
      setSelectedId(match.id);
      setView({ scale: 1.4, tx: -match.x * 1.4, ty: -match.y * 1.4 });
    }
  }, [liveHexes]);

  return (
    <div className="w-full h-[860px] max-h-[92vh] bg-slate-50 text-slate-800 flex flex-col font-sans rounded-md overflow-hidden border border-slate-200">
      <Header hour={hour} setHour={setHour} period={period} />

      <div className="flex flex-1 min-h-0">
        <Tabs active={activeTab} setActive={setActiveTab} />

        <main className="flex-1 min-w-0 min-h-0 flex flex-col">
          <SelectionBar hex={selectedHex} onClear={() => setSelectedId(null)} />

          <div className="flex-1 min-h-0">
        {activeTab === "overview" && (
          <div className="grid grid-cols-[1fr_360px] gap-4 p-4 h-full min-h-0">
            <div className="flex flex-col gap-3 min-h-0">
              <div className="grid grid-cols-4 gap-3 shrink-0">
                {selectedHex ? (
                  <>
                    <KPICard label="Potential Taxi Users" value={formatInt(selectedHex.potentialTaxiUsers)} delta={selectedHex.potentialTaxiUsers - (comparisonMode === "jakarta" ? cityAvg.potentialTaxiUsers : nearbyAvg.potentialTaxiUsers)} deltaLabel={formatSigned(((selectedHex.potentialTaxiUsers - (comparisonMode === "jakarta" ? cityAvg.potentialTaxiUsers : nearbyAvg.potentialTaxiUsers)) / (comparisonMode === "jakarta" ? cityAvg.potentialTaxiUsers : nearbyAvg.potentialTaxiUsers)) * 100) + " vs average"} icon={Users} />
                    <KPICard label="Demand Index" value={selectedHex.demandIndex} delta={selectedHex.demandIndex - 100} deltaLabel={`${Math.abs(selectedHex.demandIndex - 100)}% ${selectedHex.demandIndex >= 100 ? "above" : "below"} city average`} icon={TrendingUp} />
                    <KPICard label="Taxi Probability" value={formatPct(selectedHex.taxiProbability * 100)} delta={selectedHex.taxiProbability - cityAvg.taxiProbability} deltaLabel={formatSigned((selectedHex.taxiProbability - cityAvg.taxiProbability) * 100, 1, " pp") + " vs city average"} icon={Car} />
                    <KPICard label="Avg. Home Distance" value={formatKm(selectedHex.homeDistance)} delta={selectedHex.homeDistance - cityAvg.homeDistance} deltaLabel={formatSigned(((selectedHex.homeDistance - cityAvg.homeDistance) / cityAvg.homeDistance) * 100) + " vs city average"} icon={Navigation} />
                  </>
                ) : (
                  <>
                    <KPICard label="Estimated Potential Taxi Users" value={formatNumber(cityAvg.totalPotentialTaxiUsers)} sub={`${hour}:00 ${period.toLowerCase()} estimate`} icon={Users} />
                    <KPICard label="Average Demand Index" value="100" sub="Jakarta baseline" icon={TrendingUp} />
                    <KPICard label="Average Taxi Probability" value={formatPct(cityAvg.taxiProbability * 100)} sub="Estimated probability of using taxi" icon={Car} />
                    <KPICard label="Average Homebound Distance" value={formatKm(cityAvg.homeDistance)} sub="Across analysed zones" icon={Navigation} />
                  </>
                )}
              </div>

              <Panel className="flex-1 min-h-0 flex flex-col p-0 overflow-hidden">
                <MapControlBar layers={layers} setLayers={setLayers} mapStyle={mapStyle} setMapStyle={setMapStyle} onSearch={handleSearch} />
                <div className="flex-1 min-h-0">
                  <MapView
                    hexes={liveHexes}
                    selectedId={selectedId}
                    onSelect={(id) => setSelectedId((cur) => (cur === id ? null : id))}
                    hoveredId={hoveredId}
                    setHoveredId={setHoveredId}
                    layers={layers}
                    mapStyle={mapStyle}
                    bounds={bounds}
                    view={view}
                    setView={setView}
                    tooltipPos={tooltipPos}
                    setTooltipPos={setTooltipPos}
                  />
                </div>
              </Panel>
            </div>

            <div className="flex flex-col gap-3 min-h-0 overflow-y-auto pr-0.5">
              {selectedHex ? (
                <Panel>
                  <SectionTitle>Selected Area</SectionTitle>
                  <div className="text-[13px] font-semibold text-slate-800 mb-0.5">{selectedHex.id}</div>
                  <div className="text-[11px] text-slate-9000 mb-2">{selectedHex.district}</div>
                  <p className="text-[12px] text-slate-700 leading-relaxed">{generateDescription(selectedHex, cityAvg)}</p>
                </Panel>
              ) : (
                <Panel>
                  <SectionTitle>Jakarta Overview</SectionTitle>
                  <p className="text-[12px] text-slate-500 leading-relaxed">Delta Mobility is analysing {liveHexes.length} hexagonal zones across greater Jakarta. Select a hexagon on the map to view localised demand, mobility and demographic intelligence.</p>
                </Panel>
              )}

              {selectedHex && (
                <Panel>
                  <SectionTitle right={
                    <div className="flex bg-slate-800 rounded-sm text-[10px] overflow-hidden">
                      <button onClick={() => setComparisonMode("jakarta")} className={`px-2 py-1 ${comparisonMode === "jakarta" ? "bg-indigo-600 text-white" : "text-slate-500"}`}>Jakarta</button>
                      <button onClick={() => setComparisonMode("nearby")} className={`px-2 py-1 ${comparisonMode === "nearby" ? "bg-indigo-600 text-white" : "text-slate-500"}`}>Nearby</button>
                    </div>
                  }>Demand Comparison</SectionTitle>
                  {(() => {
                    const compareTo = comparisonMode === "jakarta" ? cityAvg : nearbyAvg;
                    const compareLabel = comparisonMode === "jakarta" ? "Jakarta Average" : "Nearby Areas Avg.";
                    const maxV = Math.max(selectedHex.potentialTaxiUsers, compareTo.potentialTaxiUsers) * 1.15;
                    const deltaPct = ((selectedHex.potentialTaxiUsers - compareTo.potentialTaxiUsers) / compareTo.potentialTaxiUsers) * 100;
                    return (
                      <>
                        <div className="flex flex-col gap-2 mb-3">
                          <ComparisonBar label="Selected Area" value={selectedHex.potentialTaxiUsers} max={maxV} color="#6366f1" />
                          <ComparisonBar label={compareLabel} value={compareTo.potentialTaxiUsers} max={maxV} color="#475569" />
                        </div>
                        <div className={`text-[11.5px] font-medium ${deltaPct >= 0 ? "text-emerald-400" : "text-red-400"} mb-2`}>
                          {deltaPct >= 0 ? "▲" : "▼"} {formatSigned(deltaPct)}
                        </div>
                        <div className="border-t border-slate-200 pt-2.5">
                          <div className="text-[13px] font-semibold text-slate-800">{percentile}th percentile</div>
                          <p className="text-[11px] text-slate-500 mt-0.5">This area has higher potential taxi demand than {percentile}% of analysed Jakarta zones.</p>
                        </div>
                      </>
                    );
                  })()}
                </Panel>
              )}

              <Panel>
                <SectionTitle>Demand by Time of Day</SectionTitle>
                <TrendChart hex={selectedHex} period={period} hour={hour} setHour={setHour} />
              </Panel>

              {selectedHex && (() => {
                const rec = recommendation(selectedHex, percentile);
                const toneMap = { red: "border-red-800 bg-red-50 text-red-300", amber: "border-amber-800 bg-amber-50 text-amber-300", blue: "border-blue-800 bg-blue-50 text-blue-300", slate: "border-slate-700 bg-slate-50 text-slate-700" };
                return (
                  <Panel className={`border ${toneMap[rec.tone]}`}>
                    <SectionTitle>Fleet Positioning Opportunity</SectionTitle>
                    <div className="text-[12.5px] font-semibold mb-1">{rec.level}</div>
                    <p className="text-[11.5px] leading-relaxed opacity-90">{rec.text}</p>
                  </Panel>
                );
              })()}

              <Panel>
                <SectionTitle>Jakarta Demand Hotspots</SectionTitle>
                <RankingTable ranked={ranked.slice(0, 10)} selectedId={selectedHex?.id} onSelect={(id) => setSelectedId(id)} />
              </Panel>
            </div>
          </div>
        )}

        {activeTab === "mobility" && <MobilityTab hex={selectedHex} cityAvg={cityAvg} />}
        {activeTab === "demographics" && <DemographicsTab hex={selectedHex} cityAvg={cityAvg} />}
      </div>

          <footer className="px-5 py-1.5 border-t border-slate-200 bg-white text-[9.5px] text-slate-500 shrink-0">
            Data note: mobility, demographic, and taxi demand figures shown in this demo are simulated for demonstration purposes and do not represent actual individual-level mobility data.
          </footer>
          </main>
        </div>
      </div>
  );
}
