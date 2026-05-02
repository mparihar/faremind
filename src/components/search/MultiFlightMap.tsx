'use client';

import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import Map, { Source, Layer, Marker, Popup } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import * as turf from '@turf/turf';
import { UnifiedFlight } from '@/lib/types';
import { RoundTripOption } from '@/lib/round-trip-types';
import { getAirportCoords } from '@/lib/airport-coords';
import { formatDuration } from '@/lib/utils';

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

// Generates a curved arc that resembles a shifted great circle
function generateArc(start: [number, number], end: [number, number], offsetKm: number): GeoJSON.LineString | null {
  if (!Number.isFinite(start[0]) || !Number.isFinite(end[0])) return null;
  if (start[0] === 0 && start[1] === 0) return null;
  if (end[0] === 0 && end[1] === 0) return null;
  
  try {
    const dist = turf.distance(start, end);
    const bearing = turf.bearing(start, end);
    const mid = turf.midpoint(start, end);
    
    // We create a bezier spline through 5 points
    const pts = [start];
    
    const pt1 = turf.destination(start, dist * 0.25, bearing);
    pts.push(turf.destination(pt1, offsetKm * 0.75, bearing + 90).geometry.coordinates as [number, number]);
    
    pts.push(turf.destination(mid, offsetKm, bearing + 90).geometry.coordinates as [number, number]);
    
    const pt3 = turf.destination(start, dist * 0.75, bearing);
    pts.push(turf.destination(pt3, offsetKm * 0.75, bearing + 90).geometry.coordinates as [number, number]);
    
    pts.push(end);
    
    const line = turf.lineString(pts);
    const curved = turf.bezierSpline(line, { resolution: 10000, sharpness: 0.85 });
    return curved.geometry as GeoJSON.LineString;
  } catch (e) {
    return null;
  }
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

  const { geojsonData, connectionAirports, labelMarkers } = useMemo(() => {
    const features: any[] = [];
    const connectionAirportsSet = new Set<string>();
    const labelMarkers: Array<{
      id: string; lng: number; lat: number;
      direction: 'out' | 'ret';
      mainText: string; subText: string; color: string;
    }> = [];

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
        rt.outboundJourney.stopAirports.forEach(a => connectionAirportsSet.add(a));
        rt.returnJourney.stopAirports.forEach(a => connectionAirportsSet.add(a));
      } else {
        const f = item as UnifiedFlight;
        outAirline = f.airline.code;
        outCode = `${f.airline.code}${f.segments[0]?.flightNumber || ''}`;
        isOutDirect = f.stops === 0;
        
        outLabel = `${outCode}  ·  ${formatDuration(f.totalDuration)}  ·  $${Math.round(price)}`;
        retLabel = outLabel;

        outPath = [f.segments[0].departure.airport, ...f.segments.map(s => s.arrival.airport)];
        f.segments.slice(0, -1).forEach(s => connectionAirportsSet.add(s.arrival.airport));
      }

      const color = AIRLINE_COLORS[outAirline] || '#475569';
      
      // Determine offset
      // To create a realistic "approximate traversing path" (great circle) with a small, clear gap
      // between the outbound and return journeys, we use a 200km base offset and a 350km return gap.
      const baseOffset = 200 + Math.floor(index / 2) * 150;
      const outOffset = index % 2 === 0 ? baseOffset : -baseOffset;
      const retOffset = outOffset > 0 ? outOffset + 350 : outOffset - 350;

      // Find longest segment index for each direction
      const outSegDists = outPath.slice(0, -1).map((_, i) =>
        turf.distance(getAirportCoords(outPath[i]), getAirportCoords(outPath[i + 1]))
      );
      const longestOutIdx = outSegDists.indexOf(Math.max(...outSegDists));

      // Outbound arcs — all segments (no text on arc, badge marker handles labeling)
      for (let i = 0; i < outPath.length - 1; i++) {
        const startCoords = getAirportCoords(outPath[i]);
        const endCoords = getAirportCoords(outPath[i + 1]);
        const outArc = generateArc(startCoords, endCoords, outOffset);
        if (outArc) {
          features.push({
            type: 'Feature',
            properties: {
              flightId: id, direction: 'outbound', label: '', fullLabel: outLabel,
              color, isDirect: isOutDirect, price: `$${Math.round(price)}`,
              airline: outAirline,
              provider: isRoundTrip ? (item as RoundTripOption).provider : (item as UnifiedFlight).provider,
              offerId: isRoundTrip ? (item as RoundTripOption).providerOfferId : (item as UnifiedFlight).providerOfferId,
              isRoundTrip,
            },
            geometry: outArc,
          });
        }
      }

      // Outbound badge marker — midpoint of longest segment arc
      const outBadgeArc = generateArc(
        getAirportCoords(outPath[longestOutIdx]),
        getAirportCoords(outPath[longestOutIdx + 1] ?? outPath[longestOutIdx]),
        outOffset
      );
      if (outBadgeArc && outBadgeArc.coordinates.length > 1) {
        const outStops = outPath.length - 2;
        const outFrac = outStops >= 2 ? 0.18 : 0.33;
        const mid = outBadgeArc.coordinates[Math.floor(outBadgeArc.coordinates.length * outFrac)];
        const rt = isRoundTrip ? (item as RoundTripOption) : null;
        labelMarkers.push({
          id, lng: mid[0], lat: mid[1], direction: 'out',
          mainText: `↗ OUT  ${rt ? formatDuration(rt.outboundJourney.durationMinutes) : formatDuration((item as UnifiedFlight).totalDuration)}  ·  $${Math.round(price)}`,
          subText: outCode,
          color,
        });
      }

      // Return arcs
      if (isRoundTrip) {
        const rt2 = item as RoundTripOption;
        const retSegDists = retPath.slice(0, -1).map((_, i) =>
          turf.distance(getAirportCoords(retPath[i]), getAirportCoords(retPath[i + 1]))
        );
        const longestRetIdx = retSegDists.indexOf(Math.max(...retSegDists));

        for (let i = 0; i < retPath.length - 1; i++) {
          const startCoords = getAirportCoords(retPath[i]);
          const endCoords = getAirportCoords(retPath[i + 1]);
          const retArc = generateArc(startCoords, endCoords, -retOffset);
          if (retArc) {
            features.push({
              type: 'Feature',
              properties: {
                flightId: id, direction: 'return', label: '', fullLabel: retLabel,
                color, isDirect: isRetDirect, price: `$${Math.round(price)}`,
                airline: retAirline, provider: rt2.provider, offerId: rt2.providerOfferId, isRoundTrip: true,
              },
              geometry: retArc,
            });
          }
        }

        // Return badge marker — for 2+ stops use first segment (near return origin DEL),
        // otherwise use longest segment
        const retStops = retPath.length - 2;
        const retBadgeSegStart = retStops >= 2 ? 0 : longestRetIdx;
        const retBadgeSegEnd   = retStops >= 2 ? 1 : (longestRetIdx + 1);
        const retBadgeArc = generateArc(
          getAirportCoords(retPath[retBadgeSegStart]),
          getAirportCoords(retPath[retBadgeSegEnd] ?? retPath[retBadgeSegStart]),
          -retOffset
        );
        if (retBadgeArc && retBadgeArc.coordinates.length > 1) {
          const retFrac = retStops >= 2 ? 0.30 : 0.33;
          const mid = retBadgeArc.coordinates[Math.floor(retBadgeArc.coordinates.length * retFrac)];
          labelMarkers.push({
            id, lng: mid[0], lat: mid[1], direction: 'ret',
            mainText: `↙ RET  ${formatDuration(rt2.returnJourney.durationMinutes)}`,
            subText: retCode,
            color,
          });
        }
      }
    });

    return {
      geojsonData: { type: 'FeatureCollection', features } as GeoJSON.FeatureCollection,
      connectionAirports: Array.from(connectionAirportsSet),
      labelMarkers,
    };
  }, [flights, roundTrips, tripType, origin, destination]);

  // Fit bounds on load
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

        map.fitBounds([[west - 20, south - 20], [east + 20, north + 25]], {
          padding: { top: 80, bottom: 80, left: 80, right: 80 },
          maxZoom: 2.5,
          duration: 0,
        });
      };
      
      const map = mapRef.current?.getMap?.();
      if (map && map.loaded()) fit();
      else if (map) map.once('load', fit);
    }
  }, [origin, destination]);

  // Force resize on mount to fix container sizing issues
  useEffect(() => {
    const timer = setTimeout(() => {
      const map = mapRef.current?.getMap?.();
      if (map) map.resize();
    }, 100);
    return () => clearTimeout(timer);
  }, []);

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

        {/* Origin and Destination Markers */}
        <Marker longitude={getAirportCoords(origin)[0]} latitude={getAirportCoords(origin)[1]} anchor="center">
          <div className="flex flex-col items-center">
            <div className="px-3 py-1.5 bg-[#0F172A] text-white text-xs font-black rounded-lg shadow-xl border border-white/20">
              {origin}
            </div>
            <div className="w-3 h-3 bg-[#0F172A] rounded-full border-2 border-white -mt-1 z-10" />
          </div>
        </Marker>

        <Marker longitude={getAirportCoords(destination)[0]} latitude={getAirportCoords(destination)[1]} anchor="center">
          <div className="flex flex-col items-center">
            <div className="px-3 py-1.5 bg-[#F97316] text-white text-xs font-black rounded-lg shadow-xl border border-white/20">
              {destination}
            </div>
            <div className="w-3 h-3 bg-[#F97316] rounded-full border-2 border-white -mt-1 z-10" />
          </div>
        </Marker>

        {/* Connection Markers */}
        {connectionAirports.map((airportCode, i) => {
          const coords = getAirportCoords(airportCode);
          if (!coords || (coords[0] === 0 && coords[1] === 0)) return null;
          
          // Stagger markers vertically so they don't overlap if they are physically very close (like FRA and ZRH)
          const yOffset = connectionAirports.length > 1 ? (i % 2 === 0 ? -12 : 12) : 0;
          
          return (
            <Marker key={airportCode} longitude={coords[0]} latitude={coords[1]} anchor="center" offset={[0, yOffset]}>
              <div className="flex flex-col items-center group relative z-10">
                <div className="px-2 py-1 bg-white/95 backdrop-blur-sm text-slate-700 text-[10px] font-bold rounded shadow-md border border-slate-300 transition-colors group-hover:bg-slate-800 group-hover:text-white group-hover:border-slate-800">
                  {airportCode}
                </div>
                <div className="w-2 h-2 bg-slate-500 rounded-full border border-white -mt-0.5 z-10 transition-colors group-hover:bg-slate-800" />
              </div>
            </Marker>
          );
        })}

        {/* Route label badges — one OUT, one RET per flight */}
        {labelMarkers.map(m => (
          <Marker key={`lbl-${m.id}-${m.direction}`} longitude={m.lng} latitude={m.lat} anchor="bottom" offset={[0, -6]}>
            <div className="pointer-events-none select-none flex flex-col items-start gap-0.5
              bg-[#0F172A]/90 backdrop-blur-sm border border-white/20 rounded-lg px-2 py-1.5 shadow-xl"
              style={{ borderLeftColor: m.color, borderLeftWidth: 3 }}>
              <span className="text-white text-[10px] font-black tracking-wide whitespace-nowrap leading-none">
                {m.mainText}
              </span>
              <span className="text-slate-400 font-mono text-[8px] whitespace-nowrap leading-none">
                {m.subText}
              </span>
            </div>
          </Marker>
        ))}

      </Map>
    </div>
  );
}
