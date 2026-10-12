// @section: Routine-Visual-Theme

import type { AppIconName } from './Icon';

export interface RoutineVisualMeta {
  colorVar: string;
  softBgVar: string;
  orbGradient: string;
  orbShadow: string;
  hex: string;
  iconName: AppIconName;
}

export function getRoutineVisualMeta(routineId: string): RoutineVisualMeta {
  const normalized = routineId.toLowerCase();
  if (normalized.includes('minoxidil')) {
    return {
      colorVar: 'var(--color-minoxidil)',
      softBgVar: 'var(--color-minoxidil-soft)',
      orbGradient: 'linear-gradient(180deg, #63b3ff 0%, #2563eb 100%)',
      orbShadow: '0 6px 14px rgba(37, 99, 235, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.35)',
      hex: '#5a9bfe',
      iconName: 'Drop',
    };
  }
  if (normalized.includes('pastilla')) {
    return {
      colorVar: 'var(--color-pastilla)',
      softBgVar: 'var(--color-pastilla-soft)',
      orbGradient: 'linear-gradient(180deg, #34e0bc 0%, #0d9488 100%)',
      orbShadow: '0 6px 14px rgba(13, 148, 136, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.35)',
      hex: '#27d3af',
      iconName: 'Pill',
    };
  }
  if (normalized.includes('dermastamp')) {
    return {
      colorVar: 'var(--color-dermastamp)',
      softBgVar: 'var(--color-dermastamp-soft)',
      orbGradient: 'linear-gradient(180deg, #c4a5ff 0%, #7c3aed 100%)',
      orbShadow: '0 6px 14px rgba(124, 58, 237, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.35)',
      hex: '#b392f0',
      iconName: 'Stamp',
    };
  }
  return {
    colorVar: 'var(--color-custom)',
    softBgVar: 'var(--color-custom-soft)',
    orbGradient: 'linear-gradient(180deg, #fbbf24 0%, #d97706 100%)',
    orbShadow: '0 6px 14px rgba(217, 119, 6, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.35)',
    hex: '#f59e0b',
    iconName: 'Clock',
  };
}

export const getRoutineTheme = getRoutineVisualMeta;

// @end: Routine-Visual-Theme
