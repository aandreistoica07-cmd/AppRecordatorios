// @section: Centralized-Phosphor-Icon

import React from 'react';
import { BellRinging } from '@phosphor-icons/react/dist/csr/BellRinging';
import { BellSlash } from '@phosphor-icons/react/dist/csr/BellSlash';
import { CalendarBlank } from '@phosphor-icons/react/dist/csr/CalendarBlank';
import { CalendarDots } from '@phosphor-icons/react/dist/csr/CalendarDots';
import { CaretDown } from '@phosphor-icons/react/dist/csr/CaretDown';
import { CaretLeft } from '@phosphor-icons/react/dist/csr/CaretLeft';
import { CaretRight } from '@phosphor-icons/react/dist/csr/CaretRight';
import { Check } from '@phosphor-icons/react/dist/csr/Check';
import { CheckCircle } from '@phosphor-icons/react/dist/csr/CheckCircle';
import { Circle } from '@phosphor-icons/react/dist/csr/Circle';
import { Clock } from '@phosphor-icons/react/dist/csr/Clock';
import { ClockCounterClockwise } from '@phosphor-icons/react/dist/csr/ClockCounterClockwise';
import { DotsThree } from '@phosphor-icons/react/dist/csr/DotsThree';
import { Drop } from '@phosphor-icons/react/dist/csr/Drop';
import { Flame } from '@phosphor-icons/react/dist/csr/Flame';
import { GearSix } from '@phosphor-icons/react/dist/csr/GearSix';
import { House } from '@phosphor-icons/react/dist/csr/House';
import { ListChecks } from '@phosphor-icons/react/dist/csr/ListChecks';
import { Moon } from '@phosphor-icons/react/dist/csr/Moon';
import { Pause } from '@phosphor-icons/react/dist/csr/Pause';
import { Pill } from '@phosphor-icons/react/dist/csr/Pill';
import { Plus } from '@phosphor-icons/react/dist/csr/Plus';
import { ShieldCheck } from '@phosphor-icons/react/dist/csr/ShieldCheck';
import { SpeakerHigh } from '@phosphor-icons/react/dist/csr/SpeakerHigh';
import { Stamp } from '@phosphor-icons/react/dist/csr/Stamp';
import { Trash } from '@phosphor-icons/react/dist/csr/Trash';
import { X } from '@phosphor-icons/react/dist/csr/X';
import type { IconWeight } from '@phosphor-icons/react/dist/lib/types';

export type AppIconName =
  | 'House'
  | 'ListChecks'
  | 'BellRinging'
  | 'CalendarBlank'
  | 'GearSix'
  | 'Drop'
  | 'Pill'
  | 'Stamp'
  | 'SpeakerHigh'
  | 'BellSlash'
  | 'Pause'
  | 'Flame'
  | 'DotsThree'
  | 'CalendarDots'
  | 'ClockCounterClockwise'
  | 'Check'
  | 'CheckCircle'
  | 'Circle'
  | 'ShieldCheck'
  | 'CaretDown'
  | 'CaretLeft'
  | 'CaretRight'
  | 'Clock'
  | 'Moon'
  | 'Plus'
  | 'Trash'
  | 'X';

const ICON_COMPONENTS: Record<
  AppIconName,
  React.ComponentType<{
    size?: number | string;
    weight?: IconWeight;
    color?: string;
    className?: string;
  }>
> = {
  House,
  ListChecks,
  BellRinging,
  CalendarBlank,
  GearSix,
  Drop,
  Pill,
  Stamp,
  SpeakerHigh,
  BellSlash,
  Pause,
  Flame,
  DotsThree,
  CalendarDots,
  ClockCounterClockwise,
  Check,
  CheckCircle,
  Circle,
  ShieldCheck,
  CaretDown,
  CaretLeft,
  CaretRight,
  Clock,
  Moon,
  Plus,
  Trash,
  X,
};

export interface IconProps {
  name: AppIconName;
  size?: number;
  weight?: 'fill' | 'bold';
  color?: string;
  className?: string;
}

export const Icon: React.FC<IconProps> = ({
  name,
  size = 24,
  weight = 'bold',
  color = 'currentColor',
  className,
}) => {
  const Component = ICON_COMPONENTS[name];
  return (
    <Component
      size={size}
      weight={weight}
      color={color}
      className={className}
    />
  );
};

// @end: Centralized-Phosphor-Icon
