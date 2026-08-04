import { Children, cloneElement, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from 'react';

type DockIconProps = { children?: ReactNode; className?: string; size?: number };

export function DockIcon({ children, className = '', size = 40 }: DockIconProps) {
  return <div className={`magic-dock-icon ${className}`} style={{ width: size, height: size }}>{children}</div>;
}

export function Dock({ children, className = '', iconSize = 40, direction = 'middle' }: {
  children: ReactNode;
  className?: string;
  iconSize?: number;
  iconMagnification?: number;
  iconDistance?: number;
  disableMagnification?: boolean;
  direction?: 'top' | 'middle' | 'bottom';
  style?: CSSProperties;
}) {
  return <div className={`magic-dock magic-dock-${direction} ${className}`}>{Children.map(children, (child) =>
    isValidElement<DockIconProps>(child) && child.type === DockIcon
      ? cloneElement(child as ReactElement<DockIconProps>, { size: iconSize })
      : child,
  )}</div>;
}
