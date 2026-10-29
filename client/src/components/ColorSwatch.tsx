import { Check } from "lucide-react";

/** Choose the more readable foreground for an opaque event color. */
export function colorForeground(hex: string): "#FFFFFF" | "#000000" {
  const rgb = hex.replace("#", "").match(/.{2}/g)!.map((v) => parseInt(v, 16) / 255);
  const linear = rgb.map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  // Choose whichever gives greater WCAG contrast against this background.
  return 1.05 / (luminance + 0.05) >= (luminance + 0.05) / 0.05 ? "#FFFFFF" : "#000000";
}

export function ColorSwatch({ color, label, selected, disabled, onClick }: {
  color: string; label: string; selected: boolean; disabled?: boolean; onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="color-swatch pressable"
      aria-label={label}
      aria-pressed={selected}
      disabled={disabled}
      onClick={onClick}
      style={{ background: color, color: colorForeground(color) }}
    >
      {selected && <Check size={16} strokeWidth={3} aria-hidden="true" />}
    </button>
  );
}
