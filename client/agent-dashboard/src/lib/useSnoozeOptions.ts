import { useMemo } from 'react';
import { useStore } from '../store/useStore';
import { DEFAULT_SNOOZE_PRESETS, presetToOption, SnoozeOption } from './snooze';

/** Snooze menu options: the workspace's custom list (Settings > General) or the default list. */
export function useSnoozeOptions(): SnoozeOption[] {
  const presets = useStore((s) => s.snoozePresets);
  return useMemo(() => (presets && presets.length ? presets : DEFAULT_SNOOZE_PRESETS).map(presetToOption), [presets]);
}
