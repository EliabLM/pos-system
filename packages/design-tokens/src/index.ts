/**
 * @pos/design-tokens — design tokens shared between the web client and the mobile app.
 *
 * One palette, one spacing scale, one type scale — consumed by both projects so
 * they don't diverge into two unrelated design languages. Fase 2+ populates the
 * real tokens; these are placeholders that establish the structure.
 */

export const colors = {
  // Neutrals
  background: '#ffffff',
  foreground: '#0a0a0a',
  muted: '#6b7280',
  border: '#e5e7eb',
  // Semantic
  primary: '#2563eb',
  destructive: '#dc2626',
  success: '#16a34a',
  warning: '#d97706',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  full: 9999,
} as const;

export type ColorToken = keyof typeof colors;
export type SpacingToken = keyof typeof spacing;
export type RadiusToken = keyof typeof radius;
