import React, { useRef } from 'react';
import { motion, useMotionValue, useSpring, useTransform, type MotionProps, type MotionValue } from 'motion/react';

type DockProps = {
  children: React.ReactNode;
  className?: string;
  iconSize?: number;
  iconMagnification?: number;
  iconDistance?: number;
  disableMagnification?: boolean;
  direction?: 'top' | 'middle' | 'bottom';
};

type DockIconProps = MotionProps & {
  className?: string;
  size?: number;
  magnification?: number;
  distance?: number;
  disableMagnification?: boolean;
  mouseX?: MotionValue<number>;
  children?: React.ReactNode;
};

const DockIcon = ({
  size = 40,
  magnification = 60,
  distance = 140,
  disableMagnification = false,
  mouseX,
  className = '',
  children,
  ...props
}: DockIconProps) => {
  const ref = useRef<HTMLDivElement>(null);
  const defaultMouseX = useMotionValue(Infinity);
  const distanceFromPointer = useTransform(mouseX ?? defaultMouseX, (value) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return value - bounds.x - bounds.width / 2;
  });
  const sizeTransform = useTransform(
    distanceFromPointer,
    [-distance, 0, distance],
    [size, disableMagnification ? size : magnification, size],
  );
  const animatedSize = useSpring(sizeTransform, { mass: 0.1, stiffness: 150, damping: 12 });

  return (
    <motion.div ref={ref} className={`magic-dock-icon ${className}`} style={{ width: animatedSize, height: animatedSize }} {...props}>
      {children}
    </motion.div>
  );
};

const Dock = React.forwardRef<HTMLDivElement, DockProps>(({
  children,
  className = '',
  iconSize = 40,
  iconMagnification = 60,
  iconDistance = 140,
  disableMagnification = false,
  direction = 'middle',
  ...props
}, ref) => {
  const mouseX = useMotionValue(Infinity);

  return (
    <motion.div
      ref={ref}
      className={`magic-dock magic-dock-${direction} ${className}`}
      onMouseMove={(event) => mouseX.set(event.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
      {...props}
    >
      {React.Children.map(children, (child) => React.isValidElement<DockIconProps>(child) && child.type === DockIcon
        ? React.cloneElement(child, { mouseX, size: iconSize, magnification: iconMagnification, distance: iconDistance, disableMagnification })
        : child)}
    </motion.div>
  );
});

Dock.displayName = 'Dock';
DockIcon.displayName = 'DockIcon';

export { Dock, DockIcon };
