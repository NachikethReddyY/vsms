import { XMarkIcon } from '@heroicons/react/24/outline';
import { useEffect, useId, useRef, type ReactNode, type RefObject } from 'react';
import './AppDialog.css';

type AppDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
};

export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  className = '',
  dismissible = true,
  initialFocusRef,
}: AppDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      window.requestAnimationFrame(() => {
        (initialFocusRef?.current
          ?? dialog.querySelector<HTMLElement>('[data-dialog-autofocus]')
          ?? dialog.querySelector<HTMLElement>('.app-dialog-content button:not([disabled]), .app-dialog-content input:not([disabled]), .app-dialog-content select:not([disabled]), .app-dialog-content textarea:not([disabled])')
          ?? dialog.querySelector<HTMLElement>('.app-dialog-close'))?.focus();
      });
    }
    if (!open && dialog.open) dialog.close();
  }, [initialFocusRef, open]);

  const returnFocus = () => {
    window.requestAnimationFrame(() => previousFocusRef.current?.focus());
  };

  return <dialog
    className={`app-dialog ${className}`.trim()}
    ref={dialogRef}
    aria-labelledby={titleId}
    aria-describedby={description ? descriptionId : undefined}
    onCancel={(event) => {
      event.preventDefault();
      if (dismissible) onOpenChange(false);
    }}
    onClose={() => {
      if (open && dismissible) onOpenChange(false);
      returnFocus();
    }}
  >
    <div className="app-dialog-panel">
      <header className="app-dialog-header">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p id={descriptionId}>{description}</p>}
        </div>
        {dismissible && <button className="app-dialog-close" type="button" onClick={() => onOpenChange(false)} aria-label={`Close ${title}`}><XMarkIcon /></button>}
      </header>
      <div className="app-dialog-content">{children}</div>
    </div>
  </dialog>;
}
