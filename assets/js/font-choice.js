/* Shared by the portfolio and its font chooser. Runs in the head before first paint. */
(() => {
  const fonts = window.PORTFOLIO_FONTS || [];
  // A new site default starts fresh instead of retaining an old font experiment.
  const key = `portfolio-font-choice:${window.PORTFOLIO_DEFAULT_FONT}`;
  const find = (id) => fonts.find((font) => font.id === id);
  const defaultFont = () => find(window.PORTFOLIO_DEFAULT_FONT) || fonts[0];
  let selected;
  function read() {
    try { return find(localStorage.getItem(key)) || defaultFont(); }
    catch { return defaultFont(); }
  }
  function apply(font) {
    if (!font) return;
    selected = font;
    document.documentElement.style.setProperty("--active-font", JSON.stringify(font.family));
    document.documentElement.dataset.font = font.id;
    window.dispatchEvent(new CustomEvent("portfoliofontchange", { detail: font }));
  }
  apply(read());
  window.PortfolioFonts = {
    fonts,
    get selected() { return selected; },
    select(id, save = true) {
      const font = find(id);
      if (!font) return false;
      if (save) { try { localStorage.setItem(key, id); } catch { /* Preview still works without storage. */ } }
      apply(font);
      return true;
    },
    reset() {
      try { localStorage.removeItem(key); } catch { /* Storage may be disabled. */ }
      apply(defaultFont());
    },
    settingsSource() {
      return '// Site-wide default. Browser previews can override this.\nwindow.PORTFOLIO_DEFAULT_FONT = ' + JSON.stringify(selected.id) + ';\n\nwindow.PORTFOLIO_FONTS = ' + JSON.stringify(fonts, null, 2) + ';\n';
    }
  };
  window.addEventListener("storage", (event) => {
    if (event.key === key || event.key === null) apply(read());
  });
})();
