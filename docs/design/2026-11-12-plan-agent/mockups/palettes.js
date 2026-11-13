// Shared palette data for Orbit mockups (v3 — true 60/30/10 surface blocking + clean pigment chroma).
// 60 = main workspace surface, 30 = contrasting structural surface (agent dock / hero console), 10 = loud action pigment.
window.ORBIT_PALETTES = [
  {
    id: 'royal-light',
    name: '1 · Royal & Sunglow',
    tag: 'cloud white · royal purple · sunglow gold',
    inspo: 'Your exact reference: crisp white + deep royal purple already looks sharp; dropping 10% sunglow gold onto the armed console makes the whole layout sing.',
    n60: 'cloud white', n30: 'royal purple', n10: 'sunglow',
    light: true,
    c60: '#F4F5FA', card: '#FFFFFF', raise: '#ECEEF6', edge: '#DFE2EE',
    ink: '#151326', ink2: '#5B5875', ink3: '#8D8AA6',
    s30: '#27175E', s30b: '#342078', s30edge: '#462E96', on30: '#F7F5FF', on30muted: '#B8AEE0',
    c30: '#4A2FA3', c10: '#FFB800', on10: '#1F1300',
    up: '#0E9F6E', down: '#E03E52'
  },
  {
    id: 'royal-dark',
    name: '2 · Midnight Royal',
    tag: 'obsidian · royal indigo · sunglow gold',
    inspo: 'The night-session twin of #1. Deep obsidian workspace, a rich royal-indigo 30% console (real surface mass, not thin lines), and luminous sunglow gold.',
    n60: 'obsidian', n30: 'royal indigo', n10: 'sunglow',
    light: false,
    c60: '#0B0C14', card: '#121422', raise: '#1A1D30', edge: '#262A42',
    ink: '#F3F2FA', ink2: '#9CA0BE', ink3: '#636887',
    s30: '#26185C', s30b: '#332275', s30edge: '#483299', on30: '#F6F4FF', on30muted: '#B9B0E2',
    c30: '#7C66DC', c10: '#FFC21A', on10: '#1F1400',
    up: '#2AD88A', down: '#FF5A6E'
  },
  {
    id: 'grand-prix',
    name: '3 · Grand Prix',
    tag: 'jet carbon · racing cobalt · sunburst',
    inspo: 'Motorsport telemetry energy. Jet carbon keeps charts effortless to read, a bold cobalt 30% dock gives real colour presence, and sunburst yellow owns the trigger.',
    n60: 'jet carbon', n30: 'racing cobalt', n10: 'sunburst',
    light: false,
    c60: '#0A0E16', card: '#111724', raise: '#192234', edge: '#25314A',
    ink: '#EFF4FB', ink2: '#94A4BE', ink3: '#5C6D89',
    s30: '#13316E', s30b: '#1A3F8B', s30edge: '#2854B0', on30: '#F2F7FF', on30muted: '#A6C0EE',
    c30: '#4B83F2', c10: '#FFD026', on10: '#1E1600',
    up: '#28D688', down: '#FF5C6C'
  },
  {
    id: 'teenage-eng',
    name: '4 · Studio Instrument',
    tag: 'warm titanium · matte black · signal orange',
    inspo: 'Braun / Teenage Engineering hardware feel. High-contrast light workspace against a pitch-black 30% tactical dock, lit by a single mechanical orange switch.',
    n60: 'titanium', n30: 'matte black', n10: 'signal orange',
    light: true,
    c60: '#F1F0EC', card: '#FAFAF8', raise: '#E5E3DC', edge: '#D6D3C9',
    ink: '#141518', ink2: '#575A62', ink3: '#8A8D96',
    s30: '#14161A', s30b: '#1E2127', s30edge: '#2E323B', on30: '#F5F5F3', on30muted: '#9CA0AA',
    c30: '#262930', c10: '#FF5917', on10: '#FFFFFF',
    up: '#0F9960', down: '#D93848'
  },
  {
    id: 'eclipse-sky',
    name: '5 · Stratosphere',
    tag: 'deep abyss · slate navy · electric cerulean',
    inspo: 'Jet-HUD precision without acid neon. Cool layered navy-slate surfaces create depth, while pure cerulean blue lights up live price and execution.',
    n60: 'deep abyss', n30: 'slate navy', n10: 'cerulean',
    light: false,
    c60: '#080D14', card: '#0F1722', raise: '#162232', edge: '#22334A',
    ink: '#ECF3FA', ink2: '#8FA5BE', ink3: '#576E87',
    s30: '#13263E', s30b: '#1A3352', s30edge: '#274973', on30: '#F0F7FF', on30muted: '#9BB8D9',
    c30: '#4DA3E8', c10: '#14B8FF', on10: '#041824',
    up: '#29D88E', down: '#FF5E73'
  },
  {
    id: 'arctic-tangerine',
    name: '6 · Nordic Signal',
    tag: 'ice white · deep oxford · vivid tangerine',
    inspo: 'Clean architectural fintech. Ice-white workspace for calm reading, anchored by a deep Oxford-navy 30% dock and a punchy tangerine trigger.',
    n60: 'ice white', n30: 'oxford navy', n10: 'tangerine',
    light: true,
    c60: '#F2F6FB', card: '#FFFFFF', raise: '#E6EEF7', edge: '#D5E0EE',
    ink: '#0E1B2E', ink2: '#51627A', ink3: '#8494AB',
    s30: '#0E2240', s30b: '#163059', s30edge: '#23457A', on30: '#F2F7FF', on30muted: '#9EB5D6',
    c30: '#1D437A', c10: '#FF6F20', on10: '#1F0B00',
    up: '#0E9B68', down: '#DC394B'
  }
];

window.applyPalette = function (el, p) {
  ['c60','card','raise','edge','ink','ink2','ink3','s30','s30b','s30edge','on30','on30muted','c30','c10','on10','up','down']
    .forEach(k => { if (p[k]) el.style.setProperty('--' + k, p[k]); });
  el.dataset.light = p.light ? '1' : '0';
};
