import type { ButtonHTMLAttributes } from 'react';

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  size?: 'default' | 'icon';
  variant?: 'default' | 'ghost';
};

export function Button({ className = '', size = 'default', variant = 'default', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={`ui-button ui-button-${variant} ui-button-${size} ${className}`} {...props} />;
}
