import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Icon, CAT_COLOR, P } from './components.jsx';
import { tx } from './i18n.js';

/**
 * City map. Pins sit at the centre of a neighbourhood (approximate), never at an exact meeting point.
 * items: [{ key, lat, lng, title, sub, href, category, kind: 'activity' | 'event' | 'tip' }]
 */
export default function MapView({ items, center, height = 460 }) {
  const el = useRef(null);
  const map = useRef(null);
  const layer = useRef(null);

  useEffect(() => {
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false }).setView(center, 13);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 19, subdomains: 'abcd',
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => { m.remove(); map.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const m = map.current; const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    // Spread pins that share a neighbourhood centre in a small circle so each stays tappable.
    const seen = {};
    const pts = [];
    for (const it of items) {
      const k = `${it.lat.toFixed(4)},${it.lng.toFixed(4)}`;
      const n = (seen[k] = (seen[k] || 0) + 1) - 1;
      const ang = n * 2.4; const r = n ? 0.0011 + 0.00025 * n : 0;
      const lat = it.lat + r * Math.cos(ang); const lng = it.lng + r * Math.sin(ang) * 1.15;
      pts.push([lat, lng]);
      const color = it.kind === 'tip' ? '#b7791f' : CAT_COLOR[it.category] || CAT_COLOR.other;
      const path = P[it.kind === 'tip' ? 'star' : it.category] || P.other;
      const html = `<span class="map-pin ${it.kind}" style="--pin:${color}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg></span>`;
      const marker = L.marker([lat, lng], { icon: L.divIcon({ html, className: 'map-pin-wrap', iconSize: [34, 34], iconAnchor: [17, 34], popupAnchor: [0, -30] }), title: it.title, keyboard: true });
      const pop = document.createElement('div');
      pop.className = 'map-pop';
      const a = document.createElement(it.href ? 'a' : 'div');
      if (it.href) a.href = it.href;
      const strong = document.createElement('strong'); strong.textContent = it.title; a.appendChild(strong);
      if (it.sub) { const s = document.createElement('span'); s.textContent = it.sub; a.appendChild(s); }
      pop.appendChild(a);
      marker.bindPopup(pop);
      g.addLayer(marker);
    }
    if (pts.length > 1) m.fitBounds(pts, { padding: [36, 36], maxZoom: 14 });
    else if (pts.length === 1) m.setView(pts[0], 14);
  }, [items]);

  return (
    <div className="map-box">
      <div ref={el} style={{ height }} role="region" aria-label={tx('Map of the city')} />
      <p className="tiny muted" style={{ padding: '8px 12px' }}><Icon name="pin" size={13} /> {tx('Pins show the neighbourhood, not the exact meeting point. Confirmed participants see the exact spot.')}</p>
    </div>
  );
}
