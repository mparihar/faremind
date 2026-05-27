'use client';

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import Map, { Source, Layer, Marker, Popup } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as turf from '@turf/turf';
import { UnifiedFlight } from '@/lib/types';
import { RoundTripOption } from '@/lib/round-trip-types';
import { getAirportCoords } from '@/lib/airport-coords';
import { formatDuration } from '@/lib/utils';
import { AIRPORTS } from '@/lib/mock-data';

interface MultiFlightMapProps {
  flights: UnifiedFlight[];
  roundTrips: RoundTripOption[];
  tripType: 'one_way' | 'round_trip';
  origin: string;
  destination: string;
  hoveredFlightId?: string | null;
  onHoverFlight?: (id: string | null) => void;
  onSelectFlight: (id: string, provider: string, offerId: string, isRoundTrip: boolean) => void;
}

const AIRLINE_COLORS: Record<string, string> = {
  'UA': '#005DAA', 'AA': '#0078D2', 'DL': '#E01933', 'BA': '#075AAA',
  'LH': '#FFCC00', 'EK': '#D71921', 'SQ': '#FABD00', 'JL': '#D90011',
  'AF': '#002157', 'KL': '#00A1DE', 'QR': '#5C0632', 'EY': '#B5A36A',
  '6E': '#FF6B00', 'AI': '#C8102E',
};

// Unwrap longitude sequence so there are no >180° jumps — fixes antimeridian artifacts in bezierSpline
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

// Generates a curved arc that resembles a shifted great circle
function generateArc(start: [number, number], end: [number, number], offsetKm: number): GeoJSON.LineString | null {
  if (!Number.isFinite(start[0]) || !Number.isFinite(end[0])) return null;
  if (start[0] === 0 && start[1] === 0) return null;
  if (end[0] === 0 && end[1] === 0) return null;

  try {
    const dist = turf.distance(start, end);
    const bearing = turf.bearing(start, end);
    const mid = turf.midpoint(start, end);

    // Build 5 control points for the spline
    const pts: [number, number][] = [start];

    const pt1 = turf.destination(start, dist * 0.25, bearing);
    pts.push(turf.destination(pt1, offsetKm * 0.75, bearing + 90).geometry.coordinates as [number, number]);

    pts.push(turf.destination(mid, offsetKm, bearing + 90).geometry.coordinates as [number, number]);

    const pt3 = turf.destination(start, dist * 0.75, bearing);
    pts.push(turf.destination(pt3, offsetKm * 0.75, bearing + 90).geometry.coordinates as [number, number]);

    pts.push(end);

    // Unwrap before passing to bezierSpline — turf uses flat 2D interpolation so a longitude
    // jump at the antimeridian (e.g. -155° → +179°) produces a wild crossing artifact.
    // Unwrapped coords may go outside [-180,180] but MapLibre GL handles that correctly.
    const unwrapped = unwrapLngs(pts);

    const line = turf.lineString(unwrapped);
    const curved = turf.bezierSpline(line, { resolution: 10000, sharpness: 0.85 });

    // Also unwrap the dense output so the rendered line stays on one side of the antimeridian
    const coords = unwrapLngs(curved.geometry.coordinates as [number, number][]);
    return { type: 'LineString', coordinates: coords };
  } catch (e) {
    return null;
  }
}

function getAirportMeta(code: string): { city: string; location: string } {
  const a = AIRPORTS.find((x) => x.code === code);
  if (!a) return { city: code, location: '' };
  const location = a.country === 'United States' ? (a.state ?? 'US') : a.country;
  return { city: a.city, location };
}

const DEFAULT_COLOR = '#94a3b8';

const OSM_RASTER_STYLE = {
  version: 8,
  glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
  sources: {
    'osm-raster': {
      type: 'raster',
      tiles: [
        'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap Contributors'
    }
  },
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: {
        'background-color': '#F8FAFC'
      }
    },
    {
      id: 'osm-raster-layer',
      type: 'raster',
      source: 'osm-raster',
      minzoom: 0,
      maxzoom: 19
    }
  ]
};

export default function MultiFlightMap(props: MultiFlightMapProps) {
  const { flights, roundTrips, tripType, origin, destination } = props;
  const [internalHoveredId, setInternalHoveredId] = useState<string | null>(null);
  const effectiveHoveredId = props.hoveredFlightId !== undefined ? props.hoveredFlightId : internalHoveredId;
  const mapRef = useRef<any>(null);

  const { geojsonData, connectionAirports, outFlightInfo, retFlightInfo } = useMemo(() => {
    const features: any[] = [];
    // Track direction for each connection airport so markers can be color-coded
    const connDirMap: Record<string, 'outbound' | 'return'> = {};

    // Flight info to embed into origin/destination pins (from first item)
    let outFlightInfo: { duration: string; price: number; flightCode: string; stops: number } | null = null as { duration: string; price: number; flightCode: string; stops: number } | null;
    let retFlightInfo: { duration: string; flightCode: string; stops: number } | null = null as { duration: string; flightCode: string; stops: number } | null;

    const items = tripType === 'round_trip' ? roundTrips : flights;

    items.forEach((item, index) => {
      let isRoundTrip = tripType === 'round_trip';
      let id = item.id;
      let price = isRoundTrip ? (item as RoundTripOption).totalPrice : (item as UnifiedFlight).totalPrice;
      
      let outCode = '';
      let retCode = '';
      let isOutDirect = true;
      let isRetDirect = true;
      let outAirline = '';
      let retAirline = '';

      let outLabel = '';
      let retLabel = '';

      let outPath: string[] = [];
      let retPath: string[] = [];

      if (isRoundTrip) {
        const rt = item as RoundTripOption;
        outAirline = rt.outboundJourney.airlineCodes[0] || '';
        outCode = rt.outboundJourney.flightNumbers?.length > 0 
          ? rt.outboundJourney.flightNumbers.join(' · ')
          : `${outAirline}${Math.floor(rt.outboundJourney.durationMinutes)}`;

        retAirline = rt.returnJourney.airlineCodes[0] || '';
        retCode = rt.returnJourney.flightNumbers?.length > 0
          ? rt.returnJourney.flightNumbers.join(' · ')
          : `${retAirline}${Math.floor(rt.returnJourney.durationMinutes)}`;

        isOutDirect = rt.outboundJourney.stops === 0;
        isRetDirect = rt.returnJourney.stops === 0;
        
        outLabel = `OUT: ${outCode}  ·  ${formatDuration(rt.outboundJourney.durationMinutes)}  ·  $${Math.round(price)}`;
        retLabel = `RET: ${retCode}  ·  ${formatDuration(rt.returnJourney.durationMinutes)}`;
        
        outPath = [rt.outboundJourney.departureAirport, ...rt.outboundJourney.stopAirports, rt.outboundJourney.arrivalAirport];
        retPath = [rt.returnJourney.departureAirport, ...rt.returnJourney.stopAirports, rt.returnJourney.arrivalAirport];
        rt.outboundJourney.stopAirports.forEach(a => { connDirMap[a] = 'outbound'; });
        rt.returnJourney.stopAirports.forEach(a => { if (!connDirMap[a]) connDirMap[a] = 'return'; });

        // Capture flight info for pins (first item only)
        if (index === 0) {
          outFlightInfo = {
            duration: formatDuration(rt.outboundJourney.durationMinutes),
            price: Math.round(price),
            flightCode: outCode,
            stops: rt.outboundJourney.stops,
          };
          retFlightInfo = {
            duration: formatDuration(rt.returnJourney.durationMinutes),
            flightCode: retCode,
            stops: rt.returnJourney.stops,
          };
        }
      } else {
        const f = item as UnifiedFlight;
        outAirline = f.airline.code;
        outCode = `${f.airline.code}${f.segments[0]?.flightNumber || ''}`;
        isOutDirect = f.stops === 0;
        
        outLabel = `${outCode}  ·  ${formatDuration(f.totalDuration)}  ·  $${Math.round(price)}`;
        retLabel = outLabel;

        outPath = [f.segments[0].departure.airport, ...f.segments.map(s => s.arrival.airport)];
        f.segments.slice(0, -1).forEach(s => { connDirMap[s.arrival.airport] = 'outbound'; });

        // Capture flight info for origin pin (first item only)
        if (index === 0) {
          outFlightInfo = {
            duration: formatDuration(f.totalDuration),
            price: Math.round(price),
            flightCode: outCode,
            stops: f.stops,
          };
        }
      }

      // Outbound arcs: dark navy; Return arcs: orange
      const outArcColor = '#0F172A';
      const retArcColor = '#F97316';
      
      // Determine offset
      // To create a realistic "approximate traversing path" (great circle) with a small, clear gap
      // between the outbound and return journeys, we use a 200km base offset and a 350km return gap.
      const baseOffset = 200 + Math.floor(index / 2) * 150;
      const outOffset = index % 2 === 0 ? baseOffset : -baseOffset;
      const retOffset = outOffset > 0 ? outOffset + 350 : outOffset - 350;

      // Outbound arcs — all segments
      for (let i = 0; i < outPath.length - 1; i++) {
        const startCoords = getAirportCoords(outPath[i]);
        const endCoords = getAirportCoords(outPath[i + 1]);
        const outArc = generateArc(startCoords, endCoords, outOffset);
        if (outArc) {
          features.push({
            type: 'Feature',
            properties: {
              flightId: id, direction: 'outbound', label: '', fullLabel: outLabel,
              color: outArcColor, isDirect: isOutDirect, price: `$${Math.round(price)}`,
              airline: outAirline,
              provider: isRoundTrip ? (item as RoundTripOption).provider : (item as UnifiedFlight).provider,
              offerId: isRoundTrip ? (item as RoundTripOption).providerOfferId : (item as UnifiedFlight).providerOfferId,
              isRoundTrip,
            },
            geometry: outArc,
          });
        }
      }

      // Return arcs
      if (isRoundTrip) {
        const rt2 = item as RoundTripOption;

        for (let i = 0; i < retPath.length - 1; i++) {
          const startCoords = getAirportCoords(retPath[i]);
          const endCoords = getAirportCoords(retPath[i + 1]);
          const retArc = generateArc(startCoords, endCoords, -retOffset);
          if (retArc) {
            features.push({
              type: 'Feature',
              properties: {
                flightId: id, direction: 'return', label: '', fullLabel: retLabel,
                color: retArcColor, isDirect: isRetDirect, price: `$${Math.round(price)}`,
                airline: retAirline, provider: rt2.provider, offerId: rt2.providerOfferId, isRoundTrip: true,
              },
              geometry: retArc,
            });
          }
        }
      }
    });

    return {
      geojsonData: { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection,
      connectionAirports: Object.entries(connDirMap).map(([code, dir]) => ({ code, direction: dir })),
      outFlightInfo,
      retFlightInfo,
    };
  }, [flights, roundTrips, tripType, origin, destination]);

  // Fit bounds on load — zoom into the trip corridor between origin & destination
  useEffect(() => {
    const originCoords = getAirportCoords(origin);
    const destCoords = getAirportCoords(destination);
    if (originCoords[0] !== 0 && destCoords[0] !== 0) {
      const fit = () => {
        const map = mapRef.current?.getMap?.();
        if (!map) return;
        
        const lats = [originCoords[1], destCoords[1]];
        const lngs = [originCoords[0], destCoords[0]];
        const west = Math.min(...lngs);
        const east = Math.max(...lngs);
        const south = Math.min(...lats);
        const north = Math.max(...lats);

        // Tighter framing: small margin so the trip corridor fills the viewport
        const lngSpan = Math.abs(east - west);
        const latSpan = Math.abs(north - south);
        const margin = Math.max(lngSpan, latSpan) * 0.12; // 12% breathing room
        const minMargin = 2; // at least 2° so very close airports still look good
        const m = Math.max(margin, minMargin);

        map.fitBounds(
          [[west - m, south - m * 0.5], [east + m, north + m * 0.8]],
          {
            // Top padding is large because pins (anchor=bottom) extend ~160px upward
            // Left/right padding is kept small so both pins fit in the narrow map panel
            padding: { top: 190, bottom: 30, left: 30, right: 30 },
            maxZoom: 5,
            duration: 0,
          }
        );
      };
      
      // Run immediately if map is ready
      const map = mapRef.current?.getMap?.();
      if (map && map.loaded()) fit();
      else if (map) map.once('load', fit);

      // Also re-fit after a short delay so the map adapts to the final container size
      const timer = setTimeout(() => {
        const m = mapRef.current?.getMap?.();
        if (m) { m.resize(); fit(); }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [origin, destination]);

  const onMouseMove = useCallback((e: any) => {
    if (e.features && e.features.length > 0) {
      const feature = e.features[0];
      const flightId = feature.properties?.flightId;
      if (flightId) {
        setInternalHoveredId(flightId);
        props.onHoverFlight?.(flightId);
        if (e.target.getCanvas) e.target.getCanvas().style.cursor = 'pointer';
        return;
      }
    }
    setInternalHoveredId(null);
    props.onHoverFlight?.(null);
    if (e.target.getCanvas) e.target.getCanvas().style.cursor = '';
  }, [props.onHoverFlight]);

  const onClick = useCallback((e: any) => {
    if (e.features && e.features.length > 0) {
      const propsData = e.features[0].properties;
      const flightId = propsData?.flightId;
      if (flightId) {
        props.onSelectFlight(flightId, propsData.provider, propsData.offerId, propsData.isRoundTrip);
      }
    }
  }, [props.onSelectFlight]);

  // Always-valid MapLibre expression for hover state — avoids TS errors from conditional expression types
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hE: any = ['==', ['get', 'flightId'], effectiveHoveredId ?? '__none__'];
  const lw  = ['case', hE, 3,    effectiveHoveredId ? 1    : 1.5] as any;
  const lo  = ['case', hE, 1,    effectiveHoveredId ? 0.15 : 0.8] as any;
  const tc  = ['case', hE, '#0F172A', effectiveHoveredId ? '#94A3B8' : '#0F172A'] as any;
  const top = ['case', hE, 1,    effectiveHoveredId ? 0.2  : 1   ] as any;

  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Map
        ref={mapRef}
        initialViewState={{ longitude: 0, latitude: 20, zoom: 1.5 }}
        mapStyle="https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"
        interactiveLayerIds={['arcs-hover-target']}
        onMouseMove={onMouseMove}
        onClick={onClick}
        onMouseLeave={() => {
          setInternalHoveredId(null);
          props.onHoverFlight?.(null);
          if (mapRef.current) mapRef.current.getMap().getCanvas().style.cursor = '';
        }}
        onLoad={() => {
          const map = mapRef.current?.getMap?.();
          if (map) map.resize();
        }}
        style={{ width: '100%', height: '100%' }}
      >
        <Source id="flight-arcs" type="geojson" data={geojsonData}>
          
          {/* Invisible thick layer for easy hovering/clicking */}
          <Layer
            id="arcs-hover-target"
            type="line"
            paint={{
              'line-color': 'transparent',
              'line-width': 15,
            }}
          />

          {/* Solid line for Direct flights */}
          <Layer
            id="arcs-solid"
            type="line"
            filter={['==', ['get', 'isDirect'], true]}
            paint={{
              'line-color': ['get', 'color'],
              'line-width': lw,
              'line-opacity': lo,
            }}
          />

          {/* Dashed line for Connecting flights */}
          <Layer
            id="arcs-dashed"
            type="line"
            filter={['==', ['get', 'isDirect'], false]}
            paint={{
              'line-color': ['get', 'color'],
              'line-width': lw,
              'line-opacity': lo,
              'line-dasharray': [3, 3],
            }}
          />

          {/* Labels centered on the arc — forced visible at all zoom levels */}
          <Layer
            id="arcs-label"
            type="symbol"
            filter={['!=', ['get', 'label'], '']}
            layout={{
              'symbol-placement': 'line-center',
              'text-field': ['get', 'label'],
              'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'],
              'text-size': ['interpolate', ['linear'], ['zoom'], 1, 10, 4, 12, 8, 13],
              'text-keep-upright': true,
              'text-anchor': 'bottom',
              'text-offset': [0, -0.5],
              'text-allow-overlap': true,
              'text-ignore-placement': true,
              'symbol-avoid-edges': false,
            }}
            paint={{
              'text-color': tc,
              'text-halo-color': 'rgba(255, 255, 255, 0.95)',
              'text-halo-width': 4,
              'text-opacity': top,
            }}
          />
        </Source>

        {/* Origin pin (dark navy) — with outbound flight info always embedded */}
        {(() => {
          const originMeta = getAirportMeta(origin);
          const destMeta = getAirportMeta(destination);
          return (
            <>
              <Marker longitude={getAirportCoords(origin)[0]} latitude={getAirportCoords(origin)[1]} anchor="bottom">
                <div className="flex flex-col items-center" style={{ filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.4))', zIndex: 50 }}>
                  <div className="relative text-white text-center" style={{ background: '#0F172A', borderRadius: '18px', padding: '12px 12px 10px', minWidth: '110px' }}>
                    {/* Top accent ring */}
                    <div className="absolute top-[-8px] left-1/2 -translate-x-1/2 w-[16px] h-[16px] rounded-full border-[3px] border-white/90" style={{ background: '#0F172A' }} />
                    <p className="text-[17px] font-black leading-none tracking-[0.08em]">{origin}</p>
                    {originMeta.city && <p className="text-[12px] font-semibold opacity-90 mt-1 leading-tight">{originMeta.city}</p>}
                    {originMeta.location && <p className="text-[10px] font-medium opacity-55 leading-tight">{originMeta.location}</p>}
                    {/* Outbound flight info — always visible */}
                    <div className="mt-2 pt-2 border-t border-white/15">
                      {outFlightInfo ? (
                        <>
                          <div className="flex items-center justify-center gap-1.5 mb-1">
                            <span className="inline-flex items-center px-2 py-[2px] rounded-full text-[8px] font-black uppercase tracking-wider bg-white/15">
                              ✈ OUT
                            </span>
                            <span className="text-[13px] font-extrabold tracking-wide">{outFlightInfo.duration}</span>
                          </div>
                          <div className="flex items-center justify-center gap-1.5">
                            <span className="text-[12px] font-black text-emerald-400">${outFlightInfo.price}</span>
                            <span className="text-[9px] font-mono opacity-50">{outFlightInfo.flightCode}</span>
                          </div>
                          <p className="text-[9px] opacity-50 mt-0.5">
                            {outFlightInfo.stops === 0 ? 'Non-stop' : `${outFlightInfo.stops} stop${outFlightInfo.stops > 1 ? 's' : ''}`}
                          </p>
                        </>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="inline-flex items-center px-2 py-[2px] rounded-full text-[8px] font-black uppercase tracking-wider bg-white/15">
                            ✈ OUT
                          </span>
                          <span className="text-[11px] font-semibold opacity-50">Loading…</span>
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Pointer triangle */}
                  <div style={{ width: 0, height: 0, borderLeft: '11px solid transparent', borderRight: '11px solid transparent', borderTop: '13px solid #0F172A', marginTop: '-1px' }} />
                  {/* Ground dot */}
                  <div className="w-3.5 h-3.5 rounded-full border-[2.5px] border-white" style={{ background: '#0F172A', marginTop: '-2px' }} />
                </div>
              </Marker>

              {/* Destination pin (orange) — with return flight info always embedded */}
              <Marker longitude={getAirportCoords(destination)[0]} latitude={getAirportCoords(destination)[1]} anchor="bottom">
                <div className="flex flex-col items-center" style={{ filter: 'drop-shadow(0 4px 16px rgba(0,0,0,0.4))', zIndex: 50 }}>
                  <div className="relative text-white text-center" style={{ background: '#F97316', borderRadius: '18px', padding: '12px 16px 10px', minWidth: '140px' }}>
                    <div className="absolute top-[-8px] left-1/2 -translate-x-1/2 w-[16px] h-[16px] rounded-full border-[3px] border-white/90" style={{ background: '#F97316' }} />
                    <p className="text-[17px] font-black leading-none tracking-[0.08em]">{destination}</p>
                    {destMeta.city && <p className="text-[12px] font-semibold opacity-95 mt-1 leading-tight">{destMeta.city}</p>}
                    {destMeta.location && <p className="text-[10px] font-medium opacity-60 leading-tight">{destMeta.location}</p>}
                    {/* Return flight info — always visible */}
                    <div className="mt-2 pt-2 border-t border-white/20">
                      {retFlightInfo ? (
                        <>
                          <div className="flex items-center justify-center gap-1.5 mb-1">
                            <span className="inline-flex items-center px-2 py-[2px] rounded-full text-[8px] font-black uppercase tracking-wider bg-black/20">
                              ✈ RET
                            </span>
                            <span className="text-[13px] font-extrabold tracking-wide">{retFlightInfo.duration}</span>
                          </div>
                          <div className="flex items-center justify-center gap-1.5">
                            <span className="text-[9px] font-mono opacity-70">{retFlightInfo.flightCode}</span>
                          </div>
                          <p className="text-[9px] opacity-60 mt-0.5">
                            {retFlightInfo.stops === 0 ? 'Non-stop' : `${retFlightInfo.stops} stop${retFlightInfo.stops > 1 ? 's' : ''}`}
                          </p>
                        </>
                      ) : (
                        <div className="flex items-center justify-center gap-1.5">
                          <span className="inline-flex items-center px-2 py-[2px] rounded-full text-[8px] font-black uppercase tracking-wider bg-black/20">
                            ✈ RET
                          </span>
                          <span className="text-[11px] font-semibold opacity-50">Loading…</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{ width: 0, height: 0, borderLeft: '11px solid transparent', borderRight: '11px solid transparent', borderTop: '13px solid #F97316', marginTop: '-1px' }} />
                  <div className="w-3.5 h-3.5 rounded-full border-[2.5px] border-white" style={{ background: '#F97316', marginTop: '-2px' }} />
                </div>
              </Marker>
            </>
          );
        })()}

        {/* Connection / Stopover Markers — color-coded: outbound=dark, return=orange */}
        {connectionAirports.map(({ code: airportCode, direction: dir }) => {
          const coords = getAirportCoords(airportCode);
          if (!coords || (coords[0] === 0 && coords[1] === 0)) return null;
          const markerColor = dir === 'outbound' ? '#0F172A' : '#F97316';
          
          return (
            <Marker key={airportCode} longitude={coords[0]} latitude={coords[1]} anchor="center">
              <div className="flex flex-col items-center" style={{ filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))', zIndex: 40 }}>
                {/* Compact color-coded label */}
                <div
                  className="px-1.5 py-[3px] text-white text-center rounded-md"
                  style={{ background: markerColor, fontSize: '8px', fontWeight: 900, letterSpacing: '0.05em', lineHeight: 1 }}
                >
                  {airportCode}
                </div>
                {/* Small dot */}
                <div className="w-[7px] h-[7px] rounded-full border-[1.5px] border-white" style={{ background: markerColor, marginTop: '-1px' }} />
              </div>
            </Marker>
          );
        })}



      </Map>
    </div>
  );
}
