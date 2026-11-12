// Anti-slop stylelint ruleset. Every finding names the tell it catches as `[tell: <id>]`.
// Tell ids and fixes: ~/.claude/skills/ui-design/references/tells.md
// Requires stylelint >= 16 (uses the `message` function and `reportDescriptionlessDisables`).

// Fill DESIGN from the project's DESIGN.md. An empty list allows only `var(--<group>-*)` tokens.
const DESIGN = {
  // DESIGN.md `typography.*.fontFamily`, family names exactly as written in CSS.
  fonts: ['system-ui', 'sans-serif', 'ui-monospace', 'monospace'],
  // DESIGN.md `typography.*.fontWeight`, two or three values.
  weights: ['400', '600'],
  // DESIGN.md `typography.*.fontSize`.
  fontSizes: ['14px', '18px'],
  // DESIGN.md `rounded.*`.
  radius: ['6px', '10px'],
  // DESIGN.md `spacing.*`.
  space: ['4px', '8px', '12px', '20px', '32px'],
  // DESIGN.md `## Elevation & Depth`, full box-shadow values.
  shadows: ['0 8px 24px rgb(0 0 0 / 12%)'],
  // DESIGN.md `typography.*.letterSpacing`.
  tracking: ['0px'],
  // Files that define the tokens as raw values. Only these may hold raw colors.
  tokenFiles: ['**/tokens.css'],
};

const GENERIC_FONTS = [
  'serif',
  'sans-serif',
  'monospace',
  'system-ui',
  'ui-sans-serif',
  'ui-serif',
  'ui-monospace',
  'cursive',
  'emoji',
  'math',
  'inherit',
  'initial',
  'unset',
];
const PURPLE_FAMILY = 'indigo|violet|purple|fuchsia';
// Tailwind v3 indigo/violet/purple/fuchsia 400-700.
const PURPLE_HEX =
  '#(?:818cf8|6366f1|4f46e5|4338ca|a78bfa|8b5cf6|7c3aed|6d28d9|c084fc|a855f7|9333ea|7e22ce|e879f9|d946ef|c026d3|a21caf)\\b';
// oklch with chroma >= 0.1 and hue 260-330 (Tailwind v4 indigo..fuchsia), hsl hue 240-299.
const PURPLE_FN =
  'oklch\\(\\s*[\\d.]+%?\\s+0?\\.(?:[1-9])\\d*\\s+(?:2[6-9]\\d|3[0-2]\\d|330)|hsla?\\(\\s*2[4-9]\\d(?:deg)?[\\s,]';
const PURPLE = `${PURPLE_HEX}|${PURPLE_FN}|\\b(?:${PURPLE_FAMILY})\\b|--color-(?:${PURPLE_FAMILY})-`;

const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const oneOf = (values) => values.map(esc).join('|');
const exact = (values) => new RegExp(`^(?:${oneOf(values)})$`);
const tokenOr = (group, values, extra = []) => [
  new RegExp(`^var\\(--${group}-[\\w-]+\\)$`),
  ...extra,
  ...(values.length ? [exact(values)] : []),
];

const fontItem = `(?:var\\(--font-[\\w-]+\\)|${[...DESIGN.fonts.flatMap((f) => [`"${f}"`, `'${f}'`, f]), ...GENERIC_FONTS].map(esc).join('|')})`;
const fontList = new RegExp(`^\\s*${fontItem}(?:\\s*,\\s*${fontItem})*\\s*$`);
const spaceItem = `(?:0|auto|-?var\\(--space-[\\w-]+\\)|calc\\(.*\\)${DESIGN.space.length ? `|-?(?:${oneOf(DESIGN.space)})` : ''})`;
const spaceList = new RegExp(`^${spaceItem}(?:\\s+${spaceItem}){0,3}$`);

// Values that are a tell wherever they appear.
const DISALLOWED = [
  {
    tell: 'ai-color-palette',
    why: 'purple/indigo gradient, the generative default',
    prop: /^background(-image)?$/,
    value: new RegExp(`gradient\\(.*(?:${PURPLE})`, 'i'),
  },
  {
    tell: 'ai-color-palette',
    why: 'purple-family token, decide the accent from the product instead',
    prop: /^--/,
    value: new RegExp(PURPLE, 'i'),
  },
  {
    tell: 'gradient-text',
    why: 'gradient or transparent text, use a solid color and size for hierarchy',
    prop: /^(-webkit-)?background-clip$/,
    value: /\btext\b/,
  },
  {
    tell: 'gradient-text',
    why: 'gradient or transparent text, use a solid color and size for hierarchy',
    prop: /^-webkit-text-fill-color$/,
    value: /transparent/,
  },
  {
    tell: 'radial-halo',
    why: 'decorative radial glow behind content',
    prop: /^background(-image)?$/,
    value: /radial-gradient\(/,
  },
  {
    tell: 'repeating-stripes-gradient',
    why: 'stripe or grid texture drawn with repeating gradients',
    prop: /^background(-image)?$/,
    value: /repeating-(linear|radial|conic)-gradient\(/,
  },
  {
    tell: 'side-tab',
    why: 'thick colored border on one side of a card',
    prop: /^border-(left|right|inline-start|inline-end)(-width)?$/,
    value: /(?:^|\s)(?:[3-9]|[1-9]\d+)(?:\.\d+)?px\b|(?:^|\s)(?:0?\.[2-9]\d*|[1-9]\d*(?:\.\d+)?)r?em\b/,
  },
  {
    tell: 'bounce-easing',
    why: 'overshooting cubic-bezier, decelerate without bounce',
    prop: /^(transition|animation)(-timing-function)?$/,
    value:
      /cubic-bezier\(\s*[\d.]+\s*,\s*(?:-|1\.\d*[1-9]|[2-9])|cubic-bezier\(\s*[\d.]+\s*,\s*-?[\d.]+\s*,\s*[\d.]+\s*,\s*(?:-|1\.\d*[1-9]|[2-9])/,
  },
  {
    tell: 'pulsing-dot',
    why: 'infinite animation simulating liveness (also marquee, blinking cursor)',
    prop: /^animation(-iteration-count)?$/,
    value: /\binfinite\b/,
  },
  { tell: 'dark-glow', why: 'text glow', prop: /^text-shadow$/, value: /^(?!none$)/ },
];

// Properties whose values must come from DESIGN.md.
const ALLOWED = [
  {
    tell: 'overused-font',
    why: 'font outside DESIGN.md typography',
    prop: /^(font-family|--font-(?!weight-)[\w-]+)$/,
    allow: [fontList],
  },
  {
    tell: 'weight-sprawl',
    why: 'font weight outside DESIGN.md',
    prop: /^(font-weight|--font-weight-[\w-]+)$/,
    allow: tokenOr('font-weight', DESIGN.weights, [/^(inherit|normal)$/]),
  },
  {
    tell: 'size-sprawl',
    why: 'font size off the DESIGN.md type scale',
    prop: /^(font-size|--text-(?:(?!--)[\w-])+)$/,
    allow: tokenOr('text', DESIGN.fontSizes, [/^(inherit|1em|100%)$/]),
  },
  {
    tell: 'radius-sprawl',
    why: 'radius outside DESIGN.md rounded',
    prop: /^(border(-(top|bottom|start|end)-(left|right|start|end))?-radius|--radius-[\w-]+)$/,
    allow: tokenOr('radius', DESIGN.radius, [/^(0|inherit)$/]),
  },
  {
    tell: 'monotonous-spacing',
    why: 'spacing off the DESIGN.md scale',
    prop: /^((margin|padding)(-(top|right|bottom|left|block|inline)(-(start|end))?)?|(row-|column-)?gap)$/,
    allow: [spaceList],
  },
  {
    tell: 'monotonous-spacing',
    why: 'spacing token outside DESIGN.md',
    prop: /^--space-[\w-]+$/,
    allow: DESIGN.space.length ? [exact(DESIGN.space)] : [],
  },
  {
    tell: 'dark-glow',
    why: 'shadow outside DESIGN.md elevation (glow, hairline+wide shadow, hard offset)',
    prop: /^(box-shadow|--shadow-[\w-]+)$/,
    allow: tokenOr('shadow', DESIGN.shadows, [/^(none|inherit)$/]),
  },
  {
    tell: 'kicker-above-heading',
    why: 'letter-spacing outside DESIGN.md (tracked eyebrow labels, crushed display type)',
    prop: /^(letter-spacing|--tracking-[\w-]+)$/,
    allow: tokenOr('tracking', DESIGN.tracking, [/^(0|normal|inherit)$/]),
  },
];

const merge = (entries, key) => {
  const out = {};
  for (const e of entries) {
    const k = String(e.prop);
    out[k] = [...(out[k] ?? []), ...(key === 'value' ? [e.value] : e.allow)];
  }
  return out;
};
const tag = (e, prop, value) => `[tell: ${e.tell}] ${e.why}: ${prop}: ${value}`;
const reported = (entries, match) => (prop, value) => {
  const e = entries.find((x) => x.prop.test(prop) && match(x, value)) ?? entries.find((x) => x.prop.test(prop));
  return tag(e, prop, value);
};

const PALETTE_DRIFT = '[tell: palette-drift] raw color outside the tokens file, use a color token';

export default {
  reportDescriptionlessDisables: true,
  reportNeedlessDisables: true,
  rules: {
    'declaration-property-value-disallowed-list': [
      merge(DISALLOWED, 'value'),
      { message: reported(DISALLOWED, (x, v) => x.value.test(v)) },
    ],
    'declaration-property-value-allowed-list': [merge(ALLOWED, 'allow'), { message: reported(ALLOWED, () => true) }],
    'color-no-hex': [true, { message: (hex) => `${PALETTE_DRIFT}: ${hex}` }],
    'color-named': ['never', { message: (name) => `${PALETTE_DRIFT}: ${name}` }],
    'function-disallowed-list': [
      ['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch'],
      { message: (fn) => `${PALETTE_DRIFT}: ${fn}()` },
    ],
  },
  overrides: [
    {
      files: DESIGN.tokenFiles,
      rules: { 'color-no-hex': null, 'color-named': null, 'function-disallowed-list': null },
    },
  ],
};
