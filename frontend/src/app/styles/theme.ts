import { createTheme, type MantineColorsTuple } from '@mantine/core';

const indigo: MantineColorsTuple = [
  '#EEF1FA',
  '#DFE5F8',
  '#C3CEF2',
  '#9DADE5',
  '#7187D5',
  '#4B63BF',
  '#3448A5',
  '#293A87',
  '#213272',
  '#182659',
];

export const theme = createTheme({
  primaryColor: 'indigo',
  primaryShade: 6,
  colors: { indigo },
  fontFamily: 'Geist Variable, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  headings: {
    fontFamily: 'Geist Variable, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    fontWeight: '650',
  },
  defaultRadius: 'sm',
  radius: {
    xs: '3px',
    sm: '6px',
    md: '8px',
    lg: '10px',
    xl: '12px',
  },
  cursorType: 'pointer',
  focusRing: 'auto',
  other: {
    canvas: '#F7F8FA',
    paper: '#FFFFFF',
    ink: '#202939',
    muted: '#667085',
    line: '#E4E7EC',
    accent: '#3448A5',
    accentHover: '#293A87',
    selected: '#EEF1FA',
    clay: '#A85D43',
  },
});
