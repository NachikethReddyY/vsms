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
    className={`app-dialog fixed inset-0 m-auto max-h-[min(42.5rem,calc(100dvh-2rem))] w-[min(30rem,calc(100vw-2rem))] overflow-auto rounded-2xl border border-[var(--line-strong,var(--hairline-strong))] bg-[var(--panel,var(--surface))] p-0 text-[var(--ink)] shadow-[0_1.5rem_4.375rem_rgba(0,0,0,.42)] backdrop:bg-black/65 max-[520px]:max-h-[calc(100dvh-1.5rem)] max-[520px]:w-[calc(100vw-1.5rem)] ${className}`.trim()}
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
    <div className="app-dialog-panel grid gap-4.5 p-5.5 max-[520px]:p-4.5">
      <header className="app-dialog-header flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="m-0 text-[1.375rem] leading-7 font-semibold tracking-[-.02em] text-[var(--ink)] max-[520px]:text-xl max-[520px]:leading-6.5" id={titleId}>{title}</h2>
          {description && <p className="mt-1.5 mb-0 text-[0.8125rem] leading-5 text-[var(--ink-2)]" id={descriptionId}>{description}</p>}
        </div>
        {dismissible && <button className="app-dialog-close -mt-2.5 -mr-2.5 grid size-11 shrink-0 cursor-pointer place-items-center rounded-lg border-0 bg-transparent p-0 text-[var(--ink-2)] transition-[background,color,transform] duration-150 hover:bg-[var(--surface-2)] hover:text-[var(--ink)] active:scale-[.97]" type="button" onClick={() => onOpenChange(false)} aria-label={`Close ${title}`}><XMarkIcon className="size-4.5" /></button>}
      </header>
      <div className="app-dialog-content min-w-0 text-[0.8125rem] leading-5 text-[var(--ink-2)]">{children}</div>
    </div>
  </dialog>;
}
