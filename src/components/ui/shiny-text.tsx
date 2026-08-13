import type { CSSProperties } from 'react';
import { clsx } from 'clsx';

interface ShinyTextProps {
  text: string;
  /** base color of the glyphs */
  color?: string;
  /** color of the highlight that sweeps across */
  shineColor?: string;
  /** one sweep in seconds */
  speed?: number;
  /** initial offset before the first sweep, in seconds */
  delay?: number;
  /** angle of the gradient in degrees */
  spread?: number;
  direction?: 'left' | 'right';
  disabled?: boolean;
  className?: string;
}

/**
 * Gradient clipped to the glyphs, swept by background-position => the React Bits ShinyText
 * look without pulling in a runtime animation lib. Pure CSS, so this stays a server component.
 *
 * One deviation from the original: `delay` is the initial animation-delay, not a hold between
 * cycles — @keyframes stop percentages can't be var driven, and a per cycle pause needs JS.
 */
export function ShinyText({
  text,
  color = '#b5b5b5',
  shineColor = '#ffffff',
  speed = 2,
  delay = 0,
  spread = 120,
  direction = 'left',
  disabled = false,
  className,
}: ShinyTextProps) {
  if (disabled) {
    return (
      <span className={clsx('inline-block', className)} style={{ color }}>
        {text}
      </span>
    );
  }

  const style = {
    backgroundImage: `linear-gradient(${spread}deg, ${color} 0%, ${color} 35%, ${shineColor} 50%, ${color} 65%, ${color} 100%)`,
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    '--shine-duration': `${speed}s`,
    '--shine-delay': `${delay}s`,
    '--shine-direction': direction === 'right' ? 'reverse' : 'normal',
  } as CSSProperties;

  return (
    <span className={clsx('shiny-text', className)} style={style}>
      {text}
    </span>
  );
}
