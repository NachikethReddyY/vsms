import { useId, useRef, useState } from "react";

type Point = { x: number; y: number };
type Stroke = Point[];

const PAD_WIDTH = 900;
const PAD_HEIGHT = 270;
const INK_COLOR = "#0f172a";
const INK_WIDTH = 5;

function signaturePng(strokes: Stroke[]) {
  const canvas = document.createElement("canvas");
  canvas.width = PAD_WIDTH;
  canvas.height = PAD_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return null;

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
  context.strokeStyle = INK_COLOR;
  context.fillStyle = INK_COLOR;
  context.lineWidth = INK_WIDTH;
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const stroke of strokes) {
    if (stroke.length === 0) continue;
    if (stroke.length === 1) {
      context.beginPath();
      context.arc(stroke[0].x, stroke[0].y, INK_WIDTH / 2, 0, Math.PI * 2);
      context.fill();
      continue;
    }

    context.beginPath();
    context.moveTo(stroke[0].x, stroke[0].y);
    for (const current of stroke.slice(1)) {
      context.lineTo(current.x, current.y);
    }
    context.stroke();
  }

  return canvas.toDataURL("image/png");
}

function typedSignaturePng(name: string) {
  const canvas = document.createElement("canvas");
  canvas.width = PAD_WIDTH;
  canvas.height = PAD_HEIGHT;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, PAD_WIDTH, PAD_HEIGHT);
  context.fillStyle = INK_COLOR;
  context.font = "italic 58px Georgia, serif";
  context.textBaseline = "middle";
  context.fillText(name, 42, PAD_HEIGHT / 2, PAD_WIDTH - 84);
  return canvas.toDataURL("image/png");
}

export function SignaturePad({ onChange, disabled = false }: { onChange: (dataUrl: string | null) => void; disabled?: boolean }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const instructionsId = useId();
  const strokesRef = useRef<Stroke[]>([]);
  const activePointerRef = useRef<number | null>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [hasSignature, setHasSignature] = useState(false);
  const [typedName, setTypedName] = useState("");

  function point(event: React.PointerEvent<SVGSVGElement>) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: ((event.clientX - rect.left) / rect.width) * PAD_WIDTH,
      y: ((event.clientY - rect.top) / rect.height) * PAD_HEIGHT,
    };
  }

  function publish(nextStrokes: Stroke[]) {
    strokesRef.current = nextStrokes;
    setStrokes(nextStrokes);
  }

  function start(event: React.PointerEvent<SVGSVGElement>) {
    event.preventDefault();
    const svg = svgRef.current;
    if (disabled || !svg || activePointerRef.current !== null) return;

    svg.setPointerCapture(event.pointerId);
    activePointerRef.current = event.pointerId;
    publish([...strokesRef.current, [point(event)]]);
    setTypedName("");
    setHasSignature(false);
    onChange(null);
  }

  function move(event: React.PointerEvent<SVGSVGElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();

    const currentStrokes = strokesRef.current;
    const lastIndex = currentStrokes.length - 1;
    if (lastIndex < 0) return;
    const nextStrokes = currentStrokes.map((stroke, index) =>
      index === lastIndex ? [...stroke, point(event)] : stroke,
    );
    publish(nextStrokes);
  }

  function finish(event: React.PointerEvent<SVGSVGElement>) {
    if (activePointerRef.current !== event.pointerId) return;
    event.preventDefault();
    activePointerRef.current = null;

    const svg = svgRef.current;
    if (svg?.hasPointerCapture(event.pointerId)) {
      svg.releasePointerCapture(event.pointerId);
    }

    const dataUrl = signaturePng(strokesRef.current);
    if (dataUrl) {
      setHasSignature(true);
      onChange(dataUrl);
    }
  }

  function clear() {
    activePointerRef.current = null;
    publish([]);
    setHasSignature(false);
    setTypedName("");
    onChange(null);
  }

  function useTypedSignature() {
    const normalized = typedName.trim().replace(/\s+/g, " ");
    if (disabled || normalized.length < 2) return;
    const dataUrl = typedSignaturePng(normalized);
    if (!dataUrl) return;
    publish([]);
    setTypedName(normalized);
    setHasSignature(true);
    onChange(dataUrl);
  }

  return (
    <div className="signature-pad-shell">
      <p id={instructionsId}>
        Sign inside the box using a mouse, stylus, or finger.
      </p>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${PAD_WIDTH} ${PAD_HEIGHT}`}
        preserveAspectRatio="none"
        className="signature-pad"
        role="img"
        aria-label="Electronic signature drawing area"
        aria-describedby={instructionsId}
        aria-disabled={disabled}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <rect width={PAD_WIDTH} height={PAD_HEIGHT} fill="#ffffff" />
        {strokes.map((stroke, strokeIndex) =>
          stroke.length === 1 ? (
            <circle
              key={strokeIndex}
              cx={stroke[0].x}
              cy={stroke[0].y}
              r={INK_WIDTH / 2}
              fill={INK_COLOR}
            />
          ) : (
            <polyline
              key={strokeIndex}
              points={stroke.map(({ x, y }) => `${x},${y}`).join(" ")}
              fill="none"
              stroke={INK_COLOR}
              strokeWidth={INK_WIDTH}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ),
        )}
      </svg>
      <div className="signature-pad-actions">
        <button
          type="button"
          className="signature-pad-clear"
          onClick={clear}
          disabled={disabled || !hasSignature}
        >
          Clear signature
        </button>
        <span className={hasSignature ? "signature-pad-status captured" : "signature-pad-status"} aria-live="polite">
          {hasSignature ? "Signature captured" : "Signature required"}
        </span>
      </div>
      <details className="signature-keyboard-option">
        <summary>Use a keyboard instead</summary>
        <div>
          <label htmlFor={`${instructionsId}-typed`}>Type your full name as your electronic signature</label>
          <div>
            <input
              id={`${instructionsId}-typed`}
              type="text"
              autoComplete="name"
              maxLength={100}
              value={typedName}
              disabled={disabled}
              onChange={(event) => { setTypedName(event.target.value); setHasSignature(false); onChange(null); }}
            />
            <button type="button" onClick={useTypedSignature} disabled={disabled || typedName.trim().length < 2}>Use signature</button>
          </div>
        </div>
      </details>
    </div>
  );
}
