'use client';

import React, { useMemo, useState, useEffect, useRef } from 'react';
import Map, { Source, Layer, Marker } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as turf from '@turf/turf';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Clock, MapPin, CreditCard, Sparkles, TrendingUp, ChevronRight } from 'lucide-react';
import { UnifiedFlight } from '@/lib/types';
import { getAirportCoords } from '@/lib/airport-coords';
import { format } from 'date-fns';

interface FlightIntelligenceMapProps {
  flights: UnifiedFlight[];
  origin: string;
  destination: string;
  onSelectFlight: (flight: UnifiedFlight) => void;
  hoveredFlightId?: string | null;
  onHoverFlight?: (id: string | null) => void;
  originCity?: string;
  destCity?: string;
  tripType?: 'one_way' | 'round_trip';
  outboundFare?: number;
  returnFare?: number;
  currency?: string;
}

function validCoord(c: [number, number]): boolean {
  return Number.isFinite(c[0]) && Number.isFinite(c[1]);
}

// Normalize longitude sequence so no consecutive jump exceeds 180° — prevents
// antimeridian artifacts in flat-2D rendering (bezierSpline, offsetArc, MapLibre layers).
// MapLibre GL supports coordinates outside [-180, 180] and renders them correctly.
function unwrapLngs(pts: [number, number][]): [number, number][] {
  if (pts.length === 0) return pts;
  const out: [number, number][] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    let lng = pts[i][0];
    const prev = out[i - 1][0];
    while (lng - prev > 180) lng -= 360;
    while (lng - prev < -180) lng += 360;
    out.push([lng, pts[i][1]]);
  }
  return out;
}

function safeGreatCircle(
  start: [number, number],
  end: [number, number]
): GeoJSON.LineString | null {
  try {
    const arc = turf.greatCircle(turf.point(start), turf.point(end), { npoints: 100 });
    const raw = arc.geometry.coordinates as [number, number][];
    if (!raw.length || !validCoord(raw[0]) || !validCoord(raw[raw.length - 1])) return null;
    // Unwrap so longitude values are continuous — fixes routes crossing the antimeridian
    const coords = unwrapLngs(raw);
    return { type: 'LineString', coordinates: coords };
  } catch {
    return null;
  }
}

function getArcPoint(arc: GeoJSON.LineString, t: number): [number, number] | null {
  const coords = arc.coordinates;
  if (!coords.length) return null;
  const i = Math.min(Math.floor(Math.max(0, t) * coords.length), coords.length - 1);
  const pt = coords[i] as [number, number];
  return validCoord(pt) ? pt : null;
}

function getArcBearing(arc: GeoJSON.LineString, t: number): number {
  const coords = arc.coordinates;
  const i = Math.min(Math.floor(Math.max(0, t) * (coords.length - 1)), coords.length - 2);
  const a = coords[i] as [number, number];
  const b = coords[i + 1] as [number, number];
  if (!validCoord(a) || !validCoord(b)) return 0;
  try { return turf.bearing(turf.point(a), turf.point(b)); } catch { return 0; }
}

// Shift every point of an arc perpendicularly (right = +offsetKm, left = negative)
function offsetArc(arc: GeoJSON.LineString, offsetKm: number): GeoJSON.LineString {
  const coords = arc.coordinates as [number, number][];
  const shifted = coords.map((pt, i) => {
    const a = coords[Math.max(0, i - 1)] as [number, number];
    const b = coords[Math.min(coords.length - 1, i + 1)] as [number, number];
    const samePoint = a[0] === b[0] && a[1] === b[1];
    const fwd = samePoint ? 0 : turf.bearing(turf.point(a), turf.point(b));
    const perp = (fwd + 90 + 360) % 360;
    try {
      return turf.destination(turf.point(pt), offsetKm, perp).geometry.coordinates as [number, number];
    } catch {
      return pt;
    }
  });
  // turf.destination normalises output to [-180,180] — re-unwrap to keep the arc continuous
  return { type: 'LineString', coordinates: unwrapLngs(shifted) };
}

const AIRPORT_COUNTRY: Record<string, string> = {
  LHR:'UK', LGW:'UK', MAN:'UK', CDG:'France', ORY:'France',
  AMS:'Netherlands', FRA:'Germany', MUC:'Germany', ZRH:'Switzerland',
  VIE:'Austria', MAD:'Spain', BCN:'Spain', FCO:'Italy', MXP:'Italy',
  DXB:'UAE', AUH:'UAE', DOH:'Qatar', IST:'Turkey', CAI:'Egypt',
  NRT:'Japan', HND:'Japan', ICN:'Korea', PEK:'China', PVG:'China',
  HKG:'Hong Kong', SIN:'Singapore', KUL:'Malaysia', BKK:'Thailand',
  CGK:'Indonesia', MNL:'Philippines', TPE:'Taiwan', DEL:'India',
  BOM:'India', CCU:'India', MAA:'India', HYD:'India', BLR:'India',
  JNB:'S.Africa', NBO:'Kenya', ADD:'Ethiopia', LAG:'Nigeria',
  YYZ:'Canada', YVR:'Canada', GRU:'Brazil', EZE:'Argentina',
  MEX:'Mexico', BOG:'Colombia', LIM:'Peru', SCL:'Chile',
  SYD:'Australia', MEL:'Australia', AKL:'New Zealand',
  ORD:'USA', JFK:'USA', LAX:'USA', ATL:'USA', DFW:'USA',
  DEN:'USA', SFO:'USA', MIA:'USA', BOS:'USA', EWR:'USA', IAH:'USA',
};

const AIRLINE_COLORS: Record<string, string> = {
  'UA': '#005DAA', 'AA': '#0078D2', 'DL': '#E01933', 'BA': '#075AAA',
  'LH': '#FFCC00', 'EK': '#D71921', 'SQ': '#FABD00', 'JL': '#D90011',
  'AF': '#002157', 'KL': '#00A1DE', 'QR': '#5C0632', 'EY': '#B5A36A',
  '6E': '#FF6B00', 'AI': '#C8102E',
};

interface SegmentArc {
  segIdx: number;
  departure: { code: string; coords: [number, number] };
  arrival: { code: string; coords: [number, number] };
  geometry: GeoJSON.LineString;
}

interface FlightPath {
  id: string;
  flight: UnifiedFlight;
  arcs: SegmentArc[];
  layoverAirports: { code: string; city: string; coords: [number, number] }[];
  midCoords: [number, number];
  color: string;
  isBest: boolean;
  index: number;
}

// ── Google Maps-style teardrop location pin ───────────────────────────────────

function LocationPin({
  city, code, color, fare, fareLabel,
}: {
  city: string; code: string; color: string;
  fare?: string; fareLabel?: string;
}) {
  return (
    <div
      className="flex flex-col items-center select-none cursor-pointer"
      style={{ filter: 'drop-shadow(0 5px 14px rgba(0,0,0,0.38))' }}
    >
      {/* Bubble body */}
      <div
        className="relative text-white text-center px-4 pt-4 pb-3"
        style={{ background: color, borderRadius: '16px', minWidth: '110px' }}
      >
        {/* White inner ring — classic Google Maps pin detail */}
        <div
          className="absolute top-[-8px] left-1/2 -translate-x-1/2 w-[16px] h-[16px] rounded-full border-[3px] border-white/90"
          style={{ background: color }}
        />
        {/* IATA code — prominent */}
        <div className="text-[16px] font-black leading-snug whitespace-nowrap mt-0.5 tracking-[0.06em]">
          {code}
        </div>
        {/* City name — clearly readable */}
        <div className="text-[12px] font-semibold opacity-90 leading-tight mt-0.5">
          {city}
        </div>
        {fare && (
          <div className="mt-2 bg-black/25 rounded-lg px-2.5 py-1 inline-flex items-center gap-1.5">
            {fareLabel && (
              <span className="text-[9px] font-bold opacity-80 uppercase tracking-wider">{fareLabel}</span>
            )}
            <span className="text-[12px] font-black">{fare}</span>
          </div>
        )}
      </div>
      {/* Pointer triangle */}
      <div
        style={{
          width: 0, height: 0,
          borderLeft: '11px solid transparent',
          borderRight: '11px solid transparent',
          borderTop: `13px solid ${color}`,
          marginTop: '-1px',
        }}
      />
      {/* Ground dot */}
      <div
        className="w-3.5 h-3.5 rounded-full border-[2.5px] border-white shadow-sm"
        style={{ background: color, marginTop: '-2px' }}
      />
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function FlightIntelligenceMap(props: FlightIntelligenceMapProps) {
  const { flights, origin, destination, onSelectFlight } = props;
  const isRoundTrip = props.tripType === 'round_trip';

  const [selectedFlight, setSelectedFlight] = useState<UnifiedFlight | null>(null);
  const [internalHoveredId, setInternalHoveredId] = useState<string | null>(null);
  const effectiveHoveredId = props.hoveredFlightId !== undefined ? props.hoveredFlightId : internalHoveredId;
  const handleHover = (id: string | null) => {
    setInternalHoveredId(id);
    props.onHoverFlight?.(id);
  };
  const [viewState, setViewState] = useState({ longitude: 0, latitude: 20, zoom: 1.5 });
  const mapRef = useRef<any>(null);

  const originCoords = getAirportCoords(origin);
  const destCoords = getAirportCoords(destination);

  // ── Map centering — show both airports at a comfortable zoom-out level ──
  useEffect(() => {
    if (originCoords[0] === 0 || destCoords[0] === 0) return;

    // Unwrap longitudes to avoid antimeridian jump
    let oLng = originCoords[0];
    let dLng = destCoords[0];
    while (dLng - oLng > 180) dLng -= 360;
    while (dLng - oLng < -180) dLng += 360;

    const centerLng = (oLng + dLng) / 2;
    const centerLat = (originCoords[1] + destCoords[1]) / 2;

    // Calculate zoom based on the geographic span — but cap it low so it never zooms in tight
    const lngSpan = Math.abs(dLng - oLng);
    const latSpan = Math.abs(originCoords[1] - destCoords[1]);
    const span = Math.max(lngSpan, latSpan);

    // World-view zoom: the larger the span, the more zoomed out
    // span ~0-30° → zoom 3, span ~30-90° → zoom 2, span 90°+ → zoom 1.5
    let zoom = 1.5;
    if (span < 30) zoom = 2.8;
    else if (span < 60) zoom = 2.2;
    else if (span < 90) zoom = 1.8;

    setViewState({ longitude: centerLng, latitude: centerLat, zoom });
  }, [origin, destination]);

  // ── Permanent route arcs (independent of flights) ─────────────────────────
  const outboundRouteArc = useMemo(() => {
    if (!validCoord(originCoords) || !validCoord(destCoords)) return null;
    if (originCoords[0] === 0 && originCoords[1] === 0) return null;
    if (destCoords[0] === 0 && destCoords[1] === 0) return null;
    return safeGreatCircle(originCoords, destCoords);
  }, [originCoords, destCoords]);

  const returnRouteArc = useMemo(() => {
    if (!isRoundTrip) return null;
    if (!validCoord(originCoords) || !validCoord(destCoords)) return null;
    if (originCoords[0] === 0 && originCoords[1] === 0) return null;
    if (destCoords[0] === 0 && destCoords[1] === 0) return null;
    return safeGreatCircle(destCoords, originCoords);
  }, [originCoords, destCoords, isRoundTrip]);

  // ── Animated planes — sequential: blue completes first, then orange starts ──
  // cycleProgress goes 0→2, then loops: [0,1) = outbound active, [1,2) = return active
  const [cycleProgress, setCycleProgress] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastTRef = useRef<number | null>(null);

  useEffect(() => {
    const SPEED = 0.000022; // full arc in ~45 s — slow, graceful
    const tick = (t: number) => {
      if (lastTRef.current !== null) {
        const dt = t - lastTRef.current;
        setCycleProgress(p => (p + SPEED * dt) % 2);
      }
      lastTRef.current = t;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current); };
  }, []);

  const isOutboundActive = cycleProgress < 1;
  const outProgress = isOutboundActive ? cycleProgress : 0;
  const retProgress = !isOutboundActive ? cycleProgress - 1 : 0;

  // Pre-offset arc geometries — outbound shifts right (south of GC), return shifts right too
  // (right of westbound = north of GC), giving two clearly separate parallel arcs
  const outboundArcGeom = useMemo(
    () => outboundRouteArc ? offsetArc(outboundRouteArc, 160) : null,
    [outboundRouteArc],
  );
  // Return arc uses a smaller offset (40 km) so it stays flatter and doesn't
  // peak as far north as the outbound arc — keeps it fully visible in the frame.
  const returnArcGeom = useMemo(
    () => returnRouteArc ? offsetArc(returnRouteArc, 40) : null,
    [returnRouteArc],
  );

  const outPlanePt = outboundArcGeom ? getArcPoint(outboundArcGeom, outProgress) : null;
  const retPlanePt = returnArcGeom   ? getArcPoint(returnArcGeom,   retProgress) : null;
  const outBearing = outboundArcGeom ? getArcBearing(outboundArcGeom, outProgress) : 0;
  const retBearing = returnArcGeom   ? getArcBearing(returnArcGeom,  retProgress)  : 0;

  // ── Flight-specific arcs (one-way search results) ──────────────────────────
  const flightPaths = useMemo((): FlightPath[] => {
    return flights.slice(0, 10).map((flight, index) => {
      const isBest = index === 0;
      const color = AIRLINE_COLORS[flight.airline.code] || '#337aff';

      const segmentArcs: SegmentArc[] = flight.segments
        .map((seg, segIdx) => {
          const start = getAirportCoords(seg.departure.airport);
          const end   = getAirportCoords(seg.arrival.airport);
          if (!validCoord(start) || !validCoord(end)) return null;
          if (start[0] === 0 && start[1] === 0) return null;
          if (end[0] === 0 && end[1] === 0) return null;
          const geometry = safeGreatCircle(start, end);
          if (!geometry) return null;
          return { segIdx, departure: { code: seg.departure.airport, coords: start }, arrival: { code: seg.arrival.airport, coords: end }, geometry };
        })
        .filter((s): s is SegmentArc => s !== null);

      const arcs: SegmentArc[] = segmentArcs.length > 0 ? segmentArcs : (() => {
        if (!validCoord(originCoords) || !validCoord(destCoords)) return [];
        if (originCoords[0] === 0 && originCoords[1] === 0) return [];
        if (destCoords[0] === 0 && destCoords[1] === 0) return [];
        const geometry = safeGreatCircle(originCoords, destCoords);
        if (!geometry) return [];
        return [{ segIdx: 0, departure: { code: origin, coords: originCoords }, arrival: { code: destination, coords: destCoords }, geometry }];
      })();

      const layoverAirports = flight.segments.length > 1
        ? flight.segments.slice(0, -1).map(seg => {
            const coords = getAirportCoords(seg.arrival.airport);
            return { code: seg.arrival.airport, city: seg.arrival.city, coords };
          }).filter(a => validCoord(a.coords) && (a.coords[0] !== 0 || a.coords[1] !== 0))
        : [];

      let midCoords: [number, number] = [(originCoords[0] + destCoords[0]) / 2, (originCoords[1] + destCoords[1]) / 2];
      if (arcs[0]) {
        const coords = arcs[0].geometry.coordinates;
        const midPt = coords[Math.floor(coords.length / 2)] as [number, number];
        if (validCoord(midPt)) midCoords = midPt;
      }

      return { id: flight.id, flight, arcs, layoverAirports, midCoords, color, isBest, index };
    });
  }, [flights, originCoords, destCoords, origin, destination]);

  // ── Imperative hover: one-way per-flight arcs ─────────────────────────────
  useEffect(() => {
    const map = mapRef.current?.getMap?.();
    if (!map || !map.isStyleLoaded()) return;
    flightPaths.forEach((path) => {
      path.arcs.forEach((arc) => {
        const id = `lyr-${path.id}-${arc.segIdx}`;
        if (!map.getLayer(id)) return;
        const isHov = effectiveHoveredId === path.id;
        const opacity = effectiveHoveredId ? (isHov ? 1 : 0) : (path.isBest ? 0.8 : 0);
        const width  = isHov ? 3 : (path.isBest ? 2 : 1);
        map.setPaintProperty(id, 'line-opacity', opacity);
        map.setPaintProperty(id, 'line-width', width);
      });
    });
  }, [effectiveHoveredId, flightPaths]);


  return (
    <div className="relative w-full h-full overflow-hidden bg-[#F8FAFC]">
      <Map
        ref={mapRef}
        {...viewState}
        onMove={evt => setViewState(evt.viewState)}
        mapStyle="https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
        style={{ width: '100%', height: '100%' }}
      >

        {/* ── Permanent outbound route arc (geographically offset right = south of GC) */}
        {outboundArcGeom && (
          <Source id="route-out" type="geojson" data={outboundArcGeom as any}>
            <Layer id="route-out-bg"   type="line" paint={{ 'line-color': '#0F172A', 'line-width': 5,   'line-opacity': 0.12 }} />
            <Layer id="route-out-dash" type="line" paint={{ 'line-color': '#0F172A', 'line-width': 2.5, 'line-opacity': 0.9, 'line-dasharray': [7, 4] }} />
          </Source>
        )}

        {/* ── Permanent return route arc (geographically offset right = north of GC) */}
        {returnArcGeom && (
          <Source id="route-ret" type="geojson" data={returnArcGeom as any}>
            <Layer id="route-ret-bg"   type="line" paint={{ 'line-color': '#F97316', 'line-width': 5,   'line-opacity': 0.12 }} />
            <Layer id="route-ret-dash" type="line" paint={{ 'line-color': '#F97316', 'line-width': 2.5, 'line-opacity': 0.9, 'line-dasharray': [7, 4] }} />
          </Source>
        )}


        {/* ── Animated plane — outbound (active during first half of cycle) ── */}
        {isOutboundActive && outPlanePt && validCoord(outPlanePt) && (
          <Marker longitude={outPlanePt[0]} latitude={outPlanePt[1]} anchor="center">
            <div
              className="pointer-events-none"
              style={{ transform: `rotate(${outBearing}deg)` }}
            >
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.35))' }}>
                <path d="M14 2 L22 24 L14 19 L6 24 Z" fill="#0F172A" stroke="white" strokeWidth="1" />
              </svg>
            </div>
          </Marker>
        )}

        {/* ── Animated plane — return (active during second half of cycle) ─ */}
        {!isOutboundActive && retPlanePt && validCoord(retPlanePt) && (
          <Marker longitude={retPlanePt[0]} latitude={retPlanePt[1]} anchor="center">
            <div
              className="pointer-events-none"
              style={{ transform: `rotate(${retBearing}deg)` }}
            >
              <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.35))' }}>
                <path d="M14 2 L22 24 L14 19 L6 24 Z" fill="#F97316" stroke="white" strokeWidth="1" />
              </svg>
            </div>
          </Marker>
        )}

        {/* ── Origin pin (outbound departure) ──────────────────────────── */}
        <Marker longitude={originCoords[0]} latitude={originCoords[1]} anchor="bottom">
          <LocationPin
            city={props.originCity || origin}
            code={origin}
            color="#0F172A"
            fare={props.outboundFare != null ? `$${props.outboundFare.toLocaleString()}` : undefined}
            fareLabel={isRoundTrip ? 'fwd' : undefined}
          />
        </Marker>

        {/* ── Destination pin (return departure) ───────────────────────── */}
        <Marker longitude={destCoords[0]} latitude={destCoords[1]} anchor="bottom">
          <LocationPin
            city={props.destCity || destination}
            code={destination}
            color="#f97316"
            fare={props.returnFare != null ? `$${props.returnFare.toLocaleString()}` : undefined}
            fareLabel={isRoundTrip ? 'ret' : undefined}
          />
        </Marker>



        {/* ── Flight-specific arcs (one-way results) ───────────────────── */}
        {flightPaths.map((path) => (
          <React.Fragment key={`arcs-${path.id}`}>
            {path.arcs.map((arc) => (
              <Source key={`src-${path.id}-${arc.segIdx}`} type="geojson" data={arc.geometry as any}>
                <Layer
                  id={`lyr-${path.id}-${arc.segIdx}`}
                  type="line"
                  paint={{
                    'line-color': path.color,
                    'line-width': effectiveHoveredId === path.id ? 3 : (path.isBest ? 2 : 1),
                    'line-opacity': effectiveHoveredId
                      ? (effectiveHoveredId === path.id ? 1 : 0)
                      : (path.isBest ? 0.8 : 0),
                  }}
                />
              </Source>
            ))}
          </React.Fragment>
        ))}

        {/* ── Layover airport pins ──────────────────────────────────────── */}
        {(() => {
          const seen = new Set<string>();
          return flightPaths.flatMap((path) =>
            path.layoverAirports
              .filter((ap) => Number.isFinite(ap.coords[0]) && Number.isFinite(ap.coords[1]) && !seen.has(ap.code) && seen.add(ap.code))
              .map((ap) => (
                <Marker key={`lv-${ap.code}`} longitude={ap.coords[0]} latitude={ap.coords[1]} anchor="bottom">
                  <div className="flex flex-col items-center pointer-events-none" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>
                    <div className="px-2 py-1 bg-slate-800/90 backdrop-blur-sm rounded-lg text-[9px] font-bold text-white border border-white/20 whitespace-nowrap text-center">
                      <div>{ap.city || ap.code}</div>
                      {AIRPORT_COUNTRY[ap.code] && <div className="font-normal opacity-60">{AIRPORT_COUNTRY[ap.code]}</div>}
                    </div>
                    <div className="w-0 h-0" style={{ borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '6px solid rgba(30,41,59,0.9)', marginTop: '-1px' }} />
                    <div className="w-2 h-2 bg-slate-600 rounded-full border border-white" style={{ marginTop: '-1px' }} />
                  </div>
                </Marker>
              ))
          );
        })()}

        {/* ── Detailed flight cards for one-way results ──────────────────────────── */}
        {flightPaths.map((path) => {
          const [lng, lat] = path.midCoords;
          if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
          
          // Spread the cards out in a wider grid to prevent overlapping
          const col = path.index % 4;
          const row = Math.floor(path.index / 4);
          const offsetX = (col - 1.5) * 80;
          const offsetY = row * -55;

          return (
            <Marker key={`plane-${path.id}`} longitude={lng} latitude={lat} anchor="bottom" offset={[offsetX, offsetY]}>
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{
                  opacity: effectiveHoveredId ? (effectiveHoveredId === path.id ? 1 : 0.3) : 1,
                  scale: effectiveHoveredId === path.id ? 1.05 : 1,
                  zIndex: effectiveHoveredId === path.id ? 50 : 10,
                }}
                onMouseEnter={() => handleHover(path.id)}
                onMouseLeave={() => handleHover(null)}
                onClick={(e) => {
                  e.stopPropagation();
                  // Save to localStorage to persist across the new tab boundary
                  localStorage.setItem('selectedFlight', JSON.stringify(path.flight));
                  window.open(`/booking?flightId=${path.flight.id}&provider=${path.flight.provider}&offerId=${path.flight.providerOfferId}`, '_blank');
                }}
                className="cursor-pointer relative z-10 flex flex-col items-center group"
              >
                <div 
                  className={`rounded-xl shadow-xl border overflow-hidden flex flex-col pointer-events-auto transition-colors ${
                    effectiveHoveredId === path.id ? 'border-[#1ABC9C] ring-2 ring-[#1ABC9C]/30' : 'border-slate-200'
                  }`}
                >
                   <div className="bg-[#0F172A] text-white px-3 py-1.5 text-[13px] font-black text-center flex items-center justify-center gap-1.5">
                      ${Math.round(path.flight.totalPrice)}
                      {path.isBest && <Sparkles className="w-3.5 h-3.5 text-amber-400" />}
                   </div>
                   <div className="px-3 py-1.5 bg-white text-[10px] font-bold text-slate-600 text-center whitespace-nowrap flex flex-col">
                      <span>{Math.floor(path.flight.totalDuration / 60)}h {path.flight.totalDuration % 60}m</span>
                      <span className="text-slate-400">
                        {path.flight.stops === 0 ? 'Non-stop' : `${path.flight.stops} stop${path.flight.stops > 1 ? 's' : ''}`}
                      </span>
                   </div>
                </div>
                {/* Tail pointer */}
                <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[8px] border-l-transparent border-r-transparent border-t-white drop-shadow-sm mt-[-1px]"></div>
              </motion.div>
            </Marker>
          );
        })}
      </Map>

      {/* AI Legend */}
      <div className="absolute top-8 left-8 z-20">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="glass-panel p-6 rounded-[32px] max-w-[280px] shadow-3xl border-white/80"
        >
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-2xl bg-[#1ABC9C]/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-[#1ABC9C]" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-800">AI Intelligence Map</h3>
              <p className="text-[10px] text-slate-500 font-bold">Personalized for your journey</p>
            </div>
          </div>
          <p className="text-[11px] text-slate-600 leading-relaxed font-medium">
            Top flights handpicked by AI based on your preferences and real-time intelligence.
          </p>
          {/* Route legend for round trips */}
          {isRoundTrip && (
            <div className="mt-3 pt-3 border-t border-white/40 flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 rounded-full bg-[#0F172A]" style={{ borderTop: '2px dashed #0F172A' }} />
                <span className="text-[10px] text-slate-600 font-semibold">{origin} → {destination}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-0.5 rounded-full bg-[#F97316]" style={{ borderTop: '2px dashed #F97316' }} />
                <span className="text-[10px] text-slate-600 font-semibold">{destination} → {origin}</span>
              </div>
            </div>
          )}
        </motion.div>
      </div>

      {/* Price trends button */}
      <div className="absolute bottom-8 right-8 z-20">
        <button className="flex items-center gap-2 px-6 py-3 rounded-full bg-white/80 backdrop-blur-md border border-white shadow-xl hover:bg-white transition-all group">
          <TrendingUp className="w-4 h-4 text-[#1ABC9C]" />
          <span className="text-xs font-black text-slate-700">View price trends</span>
          <ChevronRight className="w-4 h-4 text-slate-400 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>

      {/* Selected flight detail panel */}
      <AnimatePresence>
        {selectedFlight && (
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            className="absolute bottom-0 left-0 right-0 z-30"
          >
            <div className="glass-panel mx-auto max-w-4xl rounded-t-[32px] p-8 border-b-0">
              <div className="w-12 h-1 bg-white/10 rounded-full mx-auto mb-6" />
              <div className="flex items-start justify-between mb-8">
                <div>
                  <div className="flex items-center gap-3 mb-1">
                    <span className="text-2xl font-bold text-white">{selectedFlight.airline.name}</span>
                    {selectedFlight.tags?.includes('best_value') && (
                      <div className="px-3 py-1 rounded-full bg-[#1ABC9C]/10 text-[#1ABC9C] text-[10px] font-bold uppercase tracking-wider border border-[#1ABC9C]/20">✨ AI Pick</div>
                    )}
                  </div>
                  <p className="text-white/60 text-sm">
                    {format(new Date(selectedFlight.segments[0].departure.time), 'EEE, MMM d')} · {selectedFlight.totalDuration} min total
                  </p>
                </div>
                <button onClick={() => setSelectedFlight(null)} className="p-2 rounded-full bg-white/5 hover:bg-white/10 text-white/60 transition-colors">
                  <X className="w-6 h-6" />
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mb-8">
                <div className="md:col-span-2 space-y-6">
                  <div className="space-y-3">
                    {selectedFlight.segments.map((seg, i) => (
                      <div key={seg.id} className="flex items-center gap-3">
                        <div className="flex flex-col items-center shrink-0">
                          <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white text-xs font-bold">{seg.departure.airport}</div>
                          <span className="text-[10px] text-white/50 mt-0.5">{format(new Date(seg.departure.time), 'HH:mm')}</span>
                        </div>
                        <div className="flex-1 flex flex-col items-center gap-1">
                          <div className="w-full h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />
                          <span className="text-[9px] text-white/40 uppercase tracking-widest">{seg.airline.code} {seg.flightNumber}</span>
                        </div>
                        <div className="flex flex-col items-center shrink-0">
                          <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white text-xs font-bold">{seg.arrival.airport}</div>
                          <span className="text-[10px] text-white/50 mt-0.5">{format(new Date(seg.arrival.time), 'HH:mm')}</span>
                        </div>
                        {i < selectedFlight.segments.length - 1 && <div className="absolute ml-2 text-[9px] text-white/30">· layover</div>}
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-6">
                    <div className="flex items-center gap-2"><Clock className="w-4 h-4 text-white/40" /><span className="text-xs text-white/70">{selectedFlight.totalDuration} min</span></div>
                    <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-white/40" /><span className="text-xs text-white/70">{selectedFlight.stops === 0 ? 'Non-stop' : `${selectedFlight.stops} stop${selectedFlight.stops > 1 ? 's' : ''}`}</span></div>
                  </div>
                </div>
                <div className="bg-white/5 rounded-3xl p-6 border border-white/10 flex flex-col justify-between">
                  <div>
                    <span className="text-xs text-white/40 block mb-1">Total Fare</span>
                    <div className="flex items-end gap-1">
                      <span className="text-4xl font-bold text-white">${selectedFlight.totalPrice}</span>
                      <span className="text-sm text-white/40 mb-1">{selectedFlight.currency}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => onSelectFlight(selectedFlight)}
                    className="w-full py-4 bg-[#1ABC9C] hover:brightness-110 text-white rounded-2xl font-bold transition-all shadow-xl shadow-[#1ABC9C]/20 flex items-center justify-center gap-2 group mt-4"
                  >
                    Select Flight
                    <CreditCard className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
