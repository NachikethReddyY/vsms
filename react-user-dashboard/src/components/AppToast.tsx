import { CheckCircleIcon, ExclamationCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useCallback, useEffect, useState } from 'react';
import './AppToast.css';

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
    className={`app-toast ${tone}`}
    role={tone === 'error' ? 'alert' : 'status'}
    aria-live={tone === 'error' ? 'assertive' : 'polite'}
    onMouseEnter={() => setPaused(true)}
    onMouseLeave={() => setPaused(false)}
    onFocusCapture={() => setPaused(true)}
    onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setPaused(false); }}
  >
    <Icon aria-hidden="true" />
    <span>{message}</span>
    <button type="button" onClick={dismiss} aria-label="Dismiss notification"><XMarkIcon /></button>
  </div>;
}
