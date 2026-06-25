// User preferences, persisted separately from game state

const FONT_SCALE = { small: 0.8, medium: 1.0, large: 1.25 };

const DEFAULTS = {
  highlightPeers:     false,   // row / column / box peer tint
  highlightMatches:   true,   // same-digit bold + matching note highlight
  highlightLegal:     false,   // legal placement tint
  conflictCheck:      true,   // error / conflict highlighting
  fontSize:           'medium',
  showStrategyOnHint: false,   // show technique name alongside hint (future)
};

const _s = { ...DEFAULTS };

function emit() {
  document.dispatchEvent(new CustomEvent('settingschange'));
}

function applyFontScale() {
  document.documentElement.style.setProperty(
    '--font-scale', FONT_SCALE[_s.fontSize] ?? 1
  );
}

const settings = {
  get highlightPeers()     { return _s.highlightPeers; },
  get highlightMatches()   { return _s.highlightMatches; },
  get highlightLegal()     { return _s.highlightLegal; },
  get conflictCheck()      { return _s.conflictCheck; },
  get fontSize()           { return _s.fontSize; },
  get showStrategyOnHint() { return _s.showStrategyOnHint; },

  set(key, value) {
    _s[key] = value;
    if (key === 'fontSize') applyFontScale();
    settings.save();
    emit();
  },

  load() {
    try {
      const raw = localStorage.getItem('sudoku-settings');
      if (raw) {
        const d = JSON.parse(raw);
        for (const key of Object.keys(DEFAULTS)) {
          if (key in d) _s[key] = d[key];
        }
      }
    } catch (_) {}
    applyFontScale();
  },

  save() {
    try {
      localStorage.setItem('sudoku-settings', JSON.stringify({ ..._s }));
    } catch (_) {}
  },
};

export default settings;
