import { useEffect, useRef, useState } from 'preact/hooks';

/** What Preact's useRef<SVGSVGElement>(null) yields — a mutable current cell. */
type SvgRef = { current: SVGSVGElement | null };

export interface ViewBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface PanZoom {
  view: ViewBox;
  handlers: {
    onPointerDown: (e: PointerEvent) => void;
    onPointerMove: (e: PointerEvent) => void;
    onPointerUp: () => void;
    onWheel: (e: WheelEvent) => void;
  };
}

/**
 * Hand-rolled SVG pan/zoom over a metre-space viewBox — no pan-zoom dependency,
 * so the whole map stays pure vector. Drag pans (converting screen px to world
 * units via the live element width); wheel zooms anchored at the cursor. `target`
 * is the framing for the current selection; the view snaps to it when it changes.
 */
export function usePanZoom(svgRef: SvgRef, target: ViewBox, maxView: ViewBox): PanZoom {
  const [view, setView] = useState<ViewBox>(target);
  useEffect(() => setView(target), [target]);

  const drag = useRef<{ x: number; y: number; vb: ViewBox } | null>(null);
  const unitsPerPx = () => {
    const el = svgRef.current;
    return el ? view.w / el.getBoundingClientRect().width : 1;
  };

  const onPointerDown = (e: PointerEvent) => {
    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, vb: view };
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!drag.current) return;
    const k = unitsPerPx();
    setView({
      ...drag.current.vb,
      x: drag.current.vb.x - (e.clientX - drag.current.x) * k,
      y: drag.current.vb.y - (e.clientY - drag.current.y) * k,
    });
  };
  const onPointerUp = () => (drag.current = null);

  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const el = svgRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const fx = (e.clientX - rect.left) / rect.width; // cursor position, 0..1
    const fy = (e.clientY - rect.top) / rect.height;
    const wx = view.x + fx * view.w; // world point under the cursor
    const wy = view.y + fy * view.h;
    const factor = Math.exp(e.deltaY * 0.001); // wheel up → zoom in
    const w = Math.min(maxView.w * 1.5, Math.max(6, view.w * factor));
    const h = Math.min(maxView.h * 1.5, Math.max(6, view.h * factor));
    setView({ x: wx - fx * w, y: wy - fy * h, w, h }); // keep that world point fixed
  };

  return { view, handlers: { onPointerDown, onPointerMove, onPointerUp, onWheel } };
}
