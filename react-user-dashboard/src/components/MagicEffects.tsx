import { MoonIcon, SunIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useRef, useState, type ComponentPropsWithoutRef, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { getDisplayName, getMonogram } from '../utils/identity';

type Theme = 'light' | 'dark';
export type TransitionVariant = 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon' | 'rectangle' | 'star';
type VariableStyle = CSSProperties & Record<`--${string}`, string | number>;
type ViewTransitionHandle = { ready: Promise<void>; finished: Promise<void> };
type ViewTransitionDocument = Document & { startViewTransition?: (callback: () => void) => ViewTransitionHandle };
type ThemeToggleProps = ComponentPropsWithoutRef<'button'> & {
  duration?: number;
  variant?: TransitionVariant;
  fromCenter?: boolean;
};

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  localStorage.setItem('vsms-theme', theme);
}

function polygonCollapsed(point: string, vertexCount: number) {
  return `polygon(${Array.from({ length: vertexCount }, () => point).join(', ')})`;
}

function getThemeTransitionClipPaths(
  variant: TransitionVariant,
  cx: number,
  cy: number,
  maxRadius: number,
  viewportWidth: number,
  viewportHeight: number,
): [string, string] {
  const toX = (x: number) => `${(x / viewportWidth) * 100}%`;
  const toY = (y: number) => `${(y / viewportHeight) * 100}%`;
  const point = (x: number, y: number) => `${toX(x)} ${toY(y)}`;
  const toRadius = (radius: number) => `${(radius / (Math.hypot(viewportWidth, viewportHeight) / Math.SQRT2)) * 100}%`;
  const center = point(cx, cy);

  if (variant === 'circle') return [`circle(0% at ${center})`, `circle(${toRadius(maxRadius)} at ${center})`];

  if (variant === 'square' || variant === 'rectangle') {
    const halfWidth = Math.max(cx, viewportWidth - cx);
    const halfHeight = Math.max(cy, viewportHeight - cy);
    const width = variant === 'square' ? Math.max(halfWidth, halfHeight) * 1.05 : halfWidth;
    const height = variant === 'square' ? width : halfHeight;
    const end = [point(cx - width, cy - height), point(cx + width, cy - height), point(cx + width, cy + height), point(cx - width, cy + height)].join(', ');
    return [polygonCollapsed(center, 4), `polygon(${end})`];
  }

  if (variant === 'triangle') {
    const scale = maxRadius * 2.2;
    const dx = (Math.sqrt(3) / 2) * scale;
    const end = [point(cx, cy - scale), point(cx + dx, cy + .5 * scale), point(cx - dx, cy + .5 * scale)].join(', ');
    return [polygonCollapsed(center, 3), `polygon(${end})`];
  }

  if (variant === 'diamond') {
    const radius = maxRadius * Math.SQRT2;
    const end = [point(cx, cy - radius), point(cx + radius, cy), point(cx, cy + radius), point(cx - radius, cy)].join(', ');
    return [polygonCollapsed(center, 4), `polygon(${end})`];
  }

  if (variant === 'hexagon') {
    const radius = maxRadius * Math.SQRT2;
    const vertices = Array.from({ length: 6 }, (_, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI) / 3;
      return point(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
    });
    return [polygonCollapsed(center, 6), `polygon(${vertices.join(', ')})`];
  }

  const radius = maxRadius * Math.SQRT2 * 1.03;
  const starPolygon = (size: number) => {
    const vertices: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      const outerAngle = -Math.PI / 2 + (index * 2 * Math.PI) / 5;
      const innerAngle = outerAngle + Math.PI / 5;
      vertices.push(point(cx + size * Math.cos(outerAngle), cy + size * Math.sin(outerAngle)));
      vertices.push(point(cx + size * .42 * Math.cos(innerAngle), cy + size * .42 * Math.sin(innerAngle)));
    }
    return `polygon(${vertices.join(', ')})`;
  };
  return [starPolygon(Math.max(2, radius * .025)), starPolygon(radius)];
}

export function ThemeToggle({ className = '', duration = 400, variant = 'circle', fromCenter = false, ...props }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isTransitioningRef = useRef(false);

  useEffect(() => {
    const updateTheme = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const toggle = useCallback(() => {
    const button = buttonRef.current;
    const root = document.documentElement;
    if (!button || isTransitioningRef.current || root.dataset.vsmsThemeVt === 'active') return;

    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    const update = () => { applyTheme(next); setTheme(next); };
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const transitionDocument = document as ViewTransitionDocument;
    if (reduceMotion || !transitionDocument.startViewTransition) { update(); return; }

    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const bounds = button.getBoundingClientRect();
    const x = fromCenter ? viewportWidth / 2 : bounds.left + bounds.width / 2;
    const y = fromCenter ? viewportHeight / 2 : bounds.top + bounds.height / 2;
    const maxRadius = Math.hypot(Math.max(x, viewportWidth - x), Math.max(y, viewportHeight - y));
    const clipPath = getThemeTransitionClipPaths(variant, x, y, maxRadius, viewportWidth, viewportHeight);

    root.dataset.vsmsThemeVt = 'active';
    root.style.setProperty('--vsms-theme-toggle-duration', `${duration}ms`);
    root.style.setProperty('--vsms-theme-clip-from', clipPath[0]);
    isTransitioningRef.current = true;

    const cleanup = () => {
      isTransitioningRef.current = false;
      delete root.dataset.vsmsThemeVt;
      root.style.removeProperty('--vsms-theme-toggle-duration');
      root.style.removeProperty('--vsms-theme-clip-from');
    };

    const transition = transitionDocument.startViewTransition(() => flushSync(update));
    transition.finished.finally(cleanup).catch(() => undefined);
    transition.ready.then(() => {
      root.animate(
        { clipPath },
        {
          duration,
          easing: variant === 'star' ? 'linear' : 'ease-in-out',
          fill: 'forwards',
          pseudoElement: '::view-transition-new(root)',
        } as KeyframeAnimationOptions,
      );
    }).catch(cleanup);
  }, [duration, fromCenter, theme, variant]);

  return (
    <button {...props} ref={buttonRef} type="button" className={`icon-button theme-toggle ${className}`.trim()} onClick={toggle} aria-pressed={theme === 'light'} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
      <SunIcon className="theme-icon sun" aria-hidden="true" />
      <MoonIcon className="theme-icon moon" aria-hidden="true" />
    </button>
  );
}

export function Meteors({ count = 12 }: { count?: number }) {
  return <div className="meteors" aria-hidden="true">{Array.from({ length: count }, (_, index) => (
    <span key={index} style={{
      '--meteor-left': `${(index * 37 + 9) % 104}%`,
      '--meteor-delay': `${-((index % 8) * .68)}s`,
      '--meteor-duration': `${4.4 + (index % 5) * .55}s`,
      '--meteor-length': `${46 + (index % 4) * 15}px`,
    } as VariableStyle} />
  ))}</div>;
}

const confettiColors = ['#2563eb', '#7c3aed', '#0f9f75', '#f59e0b', '#ef5da8'];

export function ConfettiBurst({ active }: { active: boolean }) {
  if (!active) return null;
  return <div className="confetti-burst" aria-hidden="true">{Array.from({ length: 34 }, (_, index) => {
    const angle = (index / 34) * Math.PI * 2;
    const distance = 150 + (index % 6) * 28;
    return <i key={index} style={{
      '--confetti-x': `${Math.cos(angle) * distance}px`,
      '--confetti-y': `${Math.sin(angle) * distance - 80}px`,
      '--confetti-rotation': `${(index * 73) % 360}deg`,
      '--confetti-delay': `${(index % 5) * 18}ms`,
      '--confetti-color': confettiColors[index % confettiColors.length],
    } as VariableStyle} />;
  })}</div>;
}

type AvatarPerson = { userId: string; username: string };

export function AvatarCircles({ people, label }: { people: AvatarPerson[]; label: string }) {
  const visible = people.slice(0, 4);
  if (visible.length === 0) return null;
  return (
    <div className="avatar-circles" aria-label={label}>
      {visible.map((person, index) => <span className={`crew-avatar tone-${index + 1}`} key={person.userId} title={getDisplayName(person.username)} aria-label={getDisplayName(person.username)} tabIndex={0}>{getMonogram(person.username)}</span>)}
      {people.length > visible.length && <span className="crew-avatar crew-count" title={people.slice(visible.length).map((person) => getDisplayName(person.username)).join(', ')}>+{people.length - visible.length}</span>}
    </div>
  );
}

export function AnimatedCircularProgress({ value, label }: { value: number; label: string }) {
  const normalized = Math.min(100, Math.max(0, value));
  const radius = 17;
  const circumference = 2 * Math.PI * radius;
  return (
    <span className="circular-progress" aria-label={`${label}: ${normalized}%`} title={`${label}: ${normalized}%`}>
      <svg viewBox="0 0 42 42" role="img">
        <circle className="progress-track" cx="21" cy="21" r={radius} />
        <circle className="progress-value" cx="21" cy="21" r={radius} style={{ strokeDasharray: circumference, strokeDashoffset: circumference * (1 - normalized / 100) }} />
      </svg>
      <span>{normalized}</span>
    </span>
  );
}

export function SuccessConfetti() {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (sessionStorage.getItem('vsms:celebrate') !== 'true') return;
    sessionStorage.removeItem('vsms:celebrate');
    setActive(true);
    const timeout = window.setTimeout(() => setActive(false), 1500);
    return () => window.clearTimeout(timeout);
  }, []);
  return <ConfettiBurst active={active} />;
}
