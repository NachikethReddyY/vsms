import { MoonIcon, SunIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useRef, useState, type ComponentPropsWithoutRef } from 'react';
import { flushSync } from 'react-dom';

type Theme = 'light' | 'dark';
type ThemeToggleProps = ComponentPropsWithoutRef<'button'>;

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  try { localStorage.setItem('vsms-theme', theme); } catch { /* The theme still applies for this page. */ }
}

export function ThemeToggle({ className = '', ...props }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const isTransitioning = useRef(false);

  useEffect(() => {
    const updateTheme = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    const observer = new MutationObserver(updateTheme);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  const toggle = useCallback(() => {
    if (isTransitioning.current) return;

    const next: Theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    const commit = () => {
      applyTheme(next);
      setTheme(next);
    };
    const startViewTransition = document.startViewTransition?.bind(document);

    if (!buttonRef.current || !startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      commit();
      return;
    }

    const { left, top, width, height } = buttonRef.current.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
    const root = document.documentElement;

    isTransitioning.current = true;
    root.dataset.magicuiThemeVt = 'active';
    const transition = startViewTransition(() => flushSync(commit));

    transition.ready
      .then(() => root.animate(
        { clipPath: [`circle(0 at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
        { duration: 400, easing: 'ease-in-out', fill: 'forwards', pseudoElement: '::view-transition-new(root)' },
      ))
      .catch(() => undefined);
    transition.finished.finally(() => {
      isTransitioning.current = false;
      delete root.dataset.magicuiThemeVt;
    }).catch(() => undefined);
  }, []);

  return (
    <button {...props} ref={buttonRef} type="button" className={`icon-button theme-toggle ${className}`.trim()} onClick={toggle} aria-pressed={theme === 'light'} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}>
      {theme === 'dark'
        ? <SunIcon className="theme-icon" aria-hidden="true" />
        : <MoonIcon className="theme-icon" aria-hidden="true" />}
    </button>
  );
}
