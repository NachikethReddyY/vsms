import { CheckCircleIcon, ExclamationCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';

type AppToastProps = {
  message: string;
  onDismiss?: () => void;
  tone?: 'success' | 'error';
  duration?: number;
};

export function AppToast({ message, onDismiss, tone = 'success', duration = 5000 }: AppToastProps) {
  const [paused, setPaused] = useState(false);
  const [visible, setVisible] = useState(Boolean(message));

  useEffect(() => {
    setVisible(Boolean(message));
    setPaused(false);
  }, [message]);

  const dismiss = useCallback(() => {
    setVisible(false);
    onDismiss?.();
  }, [onDismiss]);

  useEffect(() => {
    if (!message || paused || !visible) return;
    const timeout = window.setTimeout(dismiss, duration);
    return () => window.clearTimeout(timeout);
  }, [dismiss, duration, message, paused, visible]);

  if (!message || !visible) return null;
  const Icon = tone === 'success' ? CheckCircleIcon : ExclamationCircleIcon;
  return <div
    className="fixed top-[max(1rem,env(safe-area-inset-top))] right-[max(1rem,env(safe-area-inset-right))] z-[120] grid min-h-13 w-[min(23.75rem,calc(100vw-2rem))] grid-cols-[1.25rem_minmax(0,1fr)_2.75rem] items-center gap-2.5 rounded-xl border border-[var(--line-strong,var(--hairline-strong))] bg-[var(--panel,var(--surface))] py-2.5 pr-2 pl-3.5 text-[0.8125rem] leading-[1.1875rem] font-semibold text-[var(--ink)] shadow-[0_0.875rem_2.5rem_rgba(0,0,0,.26)] max-[520px]:top-[max(.75rem,env(safe-area-inset-top))] max-[520px]:right-3 max-[520px]:w-[calc(100vw-1.5rem)]"
    role={tone === 'error' ? 'alert' : 'status'}
    aria-live={tone === 'error' ? 'assertive' : 'polite'}
    onMouseEnter={() => setPaused(true)}
    onMouseLeave={() => setPaused(false)}
    onFocusCapture={() => setPaused(true)}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}
  >
    <Icon className={`size-5 ${tone === 'success' ? 'text-[var(--green)]' : 'text-[var(--red)]'}`} aria-hidden="true" />
    <span className="min-w-0 wrap-anywhere">{message}</span>
    <button className="grid size-11 cursor-pointer place-items-center rounded-lg border-0 bg-transparent p-0 text-[var(--ink-2)] transition-[background,color,transform] duration-150 hover:bg-[var(--surface-2)] hover:text-[var(--ink)] active:scale-[.97]" type="button" onClick={dismiss} aria-label="Dismiss notification"><XMarkIcon className="size-[1.0625rem]" /></button>
  </div>;
}
