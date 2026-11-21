import { useEffect, useRef, useState } from 'react';
import { tx } from '../i18n.js';
import { Sheet } from '../components.jsx';

const SHAPES = { wide: 16 / 9, landscape: 4 / 3, square: 1, portrait: 3 / 4 };
const SHAPE_LABEL = { wide: 'Wide', landscape: 'Landscape', square: 'Square', portrait: 'Portrait' };

/**
 * Crop a picture before it is uploaded: drag to move, slider (or pinch / mouse wheel) to zoom, and a choice of shapes.
 * Everything happens on the phone; only the cropped, resized JPEG is sent.
 */
export function CropSheet({ file, shapes = ['wide', 'landscape', 'square'], max = 1200, round = false, title, onDone, onCancel }) {
  const [img, setImg] = useState(null);
  const [err, setErr] = useState('');
  const [shape, setShape] = useState(shapes[0]);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 }); // image centre offset from the frame centre, in frame pixels
  const [frameW, setFrameW] = useState(320);
  const frame = useRef(null);
  const pointers = useRef(new Map());
  const pinch = useRef(null);
  const aspect = SHAPES[shape];

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const i = new Image();
    i.onload = () => setImg(i);
    i.onerror = () => setErr(tx('That file does not look like a picture.'));
    i.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);
  useEffect(() => {
    const measure = () => frame.current && setFrameW(frame.current.clientWidth);
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [img]);

  const W = frameW; const H = W / aspect;
  const base = img ? Math.max(W / img.width, H / img.height) : 1;
  const scale = base * zoom;
  const dw = img ? img.width * scale : W; const dh = img ? img.height * scale : H;
  // Keep the frame always covered by the picture.
  const clamp = (p, z = zoom) => {
    const s = base * z; const w = img ? img.width * s : W; const h = img ? img.height * s : H;
    const mx = Math.max(0, (w - W) / 2); const my = Math.max(0, (h - H) / 2);
    return { x: Math.min(mx, Math.max(-mx, p.x)), y: Math.min(my, Math.max(-my, p.y)) };
  };
  useEffect(() => { setPos((p) => clamp(p)); }, [shape, frameW, img]); // eslint-disable-line react-hooks/exhaustive-deps
  const setZoomClamped = (z) => { const nz = Math.min(4, Math.max(1, z)); setZoom(nz); setPos((p) => clamp(p, nz)); };

  const down = (e) => { e.currentTarget.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); pinch.current = null; };
  const move = (e) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    pointers.current.set(e.pointerId, cur);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinch.current) setZoomClamped(zoom * (d / pinch.current));
      pinch.current = d;
      return;
    }
    setPos((p) => clamp({ x: p.x + cur.x - prev.x, y: p.y + cur.y - prev.y }));
  };
  const up = (e) => { pointers.current.delete(e.pointerId); pinch.current = null; };

  const done = () => {
    if (!img) return;
    // Visible area in the picture's own pixels.
    const left = (W - dw) / 2 + pos.x; const top = (H - dh) / 2 + pos.y;
    const sx = -left / scale; const sy = -top / scale; const sw = W / scale; const sh = H / scale;
    const outW = Math.round(Math.min(max, sw, aspect >= 1 ? max : max * aspect));
    const outH = Math.round(outW / aspect);
    const c = document.createElement('canvas'); c.width = outW; c.height = outH;
    c.getContext('2d').drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
    onDone(c.toDataURL('image/jpeg', 0.82));
  };

  return (
    <Sheet title={title || tx('Adjust your photo')} onClose={onCancel}>
      <div className="stack">
        {err ? <div className="form-error" role="alert">{err}</div> : (
          <>
            <div ref={frame} className={`crop-frame ${round ? 'round' : ''}`} style={{ height: H }}
              onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
              onWheel={(e) => setZoomClamped(zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08))}>
              {img && <img src={img.src} alt="" draggable={false}
                style={{ width: dw, height: dh, left: (W - dw) / 2 + pos.x, top: (H - dh) / 2 + pos.y }} />}
            </div>
            <p className="hint" style={{ margin: 0 }}>{tx('Drag to move the picture. Use the slider or two fingers to zoom.')}</p>
            <label className="field"><span>{tx('Zoom')}</span>
              <input type="range" min="1" max="4" step="0.01" value={zoom} onChange={(e) => setZoomClamped(Number(e.target.value))} />
            </label>
            {shapes.length > 1 && (
              <div className="row wrap" style={{ gap: 8 }} role="radiogroup" aria-label={tx('Shape')}>
                {shapes.map((k) => <button key={k} type="button" role="radio" aria-checked={shape === k} className={`chip chip-sm ${shape === k ? 'on' : ''}`} onClick={() => setShape(k)}>{tx(SHAPE_LABEL[k])}</button>)}
              </div>
            )}
          </>
        )}
        <button type="button" className="btn btn-primary btn-block" disabled={!img} onClick={done}>{tx('Use this photo')}</button>
        <button type="button" className="btn btn-ghost btn-block" onClick={onCancel}>{tx('Cancel')}</button>
      </div>
    </Sheet>
  );
}
