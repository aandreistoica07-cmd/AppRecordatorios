// @section: Custom-Controls-Library

import React, { useEffect, useState } from 'react';
import { formatHHMM, parseHHMM } from '../core/scheduler';
import { Icon } from './Icon';

let activeSheetLockCount = 0;

function useLockBodyScroll(open: boolean): void {
  useEffect(() => {
    if (!open || typeof document === 'undefined') return;
    activeSheetLockCount += 1;
    const html = document.documentElement;
    const body = document.body;
    html.classList.add('sheet-scroll-locked');
    body.classList.add('sheet-scroll-locked');

    return () => {
      activeSheetLockCount = Math.max(0, activeSheetLockCount - 1);
      if (activeSheetLockCount === 0) {
        html.classList.remove('sheet-scroll-locked');
        body.classList.remove('sheet-scroll-locked');
      }
    };
  }, [open]);
}

interface SegmentedControlOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (next: T) => void;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
}: SegmentedControlProps<T>) {
  const activeIdx = Math.max(
    0,
    options.findIndex((o) => o.value === value)
  );
  const count = Math.max(1, options.length);

  return (
    <div
      className="segmented-control"
      role="tablist"
      style={{ gridTemplateColumns: `repeat(${count}, 1fr)` }}
    >
      <div
        className="segmented-sliding-thumb"
        style={{
          width: `calc((100% - 8px) / ${count})`,
          transform: `translateX(${activeIdx * 100}%)`,
        }}
      />
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="tab"
            aria-selected={active}
            className={`segmented-option ${active ? 'active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

interface WrapChoiceChipsProps<T extends string> {
  options: SegmentedControlOption<T>[];
  value: T;
  onChange: (next: T) => void;
  ariaLabel?: string;
}

/**
 * Selector de chips con salto de línea (flex-wrap) y soporte para nombres largos o muchas rutinas,
 * evitando que las opciones se corten por la derecha dentro de hojas inferiores.
 */
export function WrapChoiceChips<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
}: WrapChoiceChipsProps<T>) {
  return (
    <div className="wrap-choice-chips" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={active}
            className={`wrap-choice-chip ${active ? 'active' : ''}`}
            onClick={() => onChange(opt.value)}
          >
            <Icon
              name={active ? 'CheckCircle' : 'Circle'}
              size={18}
              weight={active ? 'fill' : 'bold'}
              color={active ? '#27d3af' : 'var(--text-secondary)'}
            />
            <span className="wrap-choice-chip-label">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

interface IOSSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  ariaLabel?: string;
}

export const IOSSwitch: React.FC<IOSSwitchProps> = ({
  checked,
  onChange,
  ariaLabel,
}) => {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      className={`ios-switch ${checked ? 'checked' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
    >
      <span className="ios-switch-thumb" />
    </button>
  );
};

interface TimePickerSheetProps {
  open: boolean;
  title: string;
  subtitle?: string;
  initialHHMM: string;
  confirmLabel?: string;
  onConfirm: (hhmm: string) => void;
  onClose: () => void;
}

const HOURS_24 = Array.from({ length: 24 }, (_, i) => i);
const MINUTES_STEP_5 = Array.from({ length: 12 }, (_, i) => i * 5);

export const TimePickerSheet: React.FC<TimePickerSheetProps> = ({
  open,
  title,
  subtitle,
  initialHHMM,
  confirmLabel = 'Confirmar',
  onConfirm,
  onClose,
}) => {
  useLockBodyScroll(open);

  const parsed = parseHHMM(initialHHMM);
  const [selectedHour, setSelectedHour] = useState<number>(parsed.hours);
  const [selectedMinute, setSelectedMinute] = useState<number>(
    (Math.round(parsed.minutes / 5) * 5) % 60
  );

  useEffect(() => {
    if (open) {
      const p = parseHHMM(initialHHMM);
      setSelectedHour(p.hours);
      setSelectedMinute((Math.round(p.minutes / 5) * 5) % 60);
    }
  }, [open, initialHHMM]);

  if (!open) return null;

  const formattedCurrent = formatHHMM(selectedHour, selectedMinute);

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="bottom-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-header-text">
            <h3 className="sheet-title">{title}</h3>
            {subtitle && <p className="sheet-subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="icon-circle-btn"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <Icon name="X" size={20} weight="bold" />
          </button>
        </div>

        <div className="time-wheel-preview">{formattedCurrent}</div>

        <div className="time-wheel-columns">
          <div className="wheel-col">
            <span className="wheel-col-label">Hora</span>
            <div className="wheel-scroll-list">
              {HOURS_24.map((h) => (
                <button
                  key={h}
                  type="button"
                  className={`wheel-item ${selectedHour === h ? 'selected' : ''}`}
                  onClick={() => setSelectedHour(h)}
                >
                  {String(h).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>

          <div className="wheel-col">
            <span className="wheel-col-label">Minutos</span>
            <div className="wheel-scroll-list">
              {MINUTES_STEP_5.map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`wheel-item ${
                    selectedMinute === m ? 'selected' : ''
                  }`}
                  onClick={() => setSelectedMinute(m)}
                >
                  {String(m).padStart(2, '0')}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="primary-action-btn"
          onClick={() => {
            onConfirm(formattedCurrent);
            onClose();
          }}
        >
          {confirmLabel} ({formattedCurrent})
        </button>
      </div>
    </div>
  );
};

interface BottomSheetProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
  open,
  title,
  subtitle,
  onClose,
  children,
}) => {
  useLockBodyScroll(open);

  if (!open) return null;

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="bottom-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="sheet-handle" />
        <div className="sheet-header">
          <div className="sheet-header-text">
            <h3 className="sheet-title">{title}</h3>
            {subtitle && <p className="sheet-subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="icon-circle-btn"
            onClick={onClose}
            aria-label="Cerrar"
          >
            <Icon name="X" size={20} weight="bold" />
          </button>
        </div>
        <div className="sheet-scroll-body">{children}</div>
      </div>
    </div>
  );
};

// @end: Custom-Controls-Library
