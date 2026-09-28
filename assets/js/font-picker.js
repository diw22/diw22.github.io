(() => {
  const api = window.PortfolioFonts;
  const list = document.getElementById("fontList");
  const frame = document.getElementById("sitePreview");
  const page = document.getElementById("previewPage");
  const sample = document.getElementById("sampleText");
  const status = document.getElementById("fontStatus");
  let version = 0;

  api.fonts.forEach((font) => {
    const label = document.createElement("label");
    label.className = "font-option";
    const radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "font";
    radio.value = font.id;
    const copy = document.createElement("span");
    const name = document.createElement("span");
    name.className = "font-name";
    name.textContent = font.family;
    const specimen = document.createElement("span");
    specimen.className = "font-sample";
    specimen.setAttribute("aria-hidden", "true");
    specimen.style.setProperty("--sample-font", JSON.stringify(font.family));
    specimen.textContent = "Dylan Winters";
    copy.append(name, specimen);
    label.append(radio, copy);
    list.append(label);
    radio.addEventListener("change", () => { if (radio.checked) api.select(font.id); });
  });

  function syncPreview() {
    frame.contentWindow?.PortfolioFonts?.select(api.selected.id, false);
  }
  async function update() {
    const font = api.selected;
    const current = ++version;
    [...list.querySelectorAll("input")].forEach((input) => { input.checked = input.value === font.id; });
    document.getElementById("activeFont").textContent = `Active: ${font.family}`;
    status.textContent = "";
    syncPreview();
    try {
      const loaded = await document.fonts.load(`400 34px ${JSON.stringify(font.family)}`);
      if (current === version && !loaded.length) status.textContent = "This font could not load. Try another font or refresh.";
    } catch {
      if (current === version) status.textContent = "This font could not load. Try another font or refresh.";
    }
  }
  window.addEventListener("portfoliofontchange", update);
  frame.addEventListener("load", syncPreview);
  page.addEventListener("change", () => {
    frame.src = `index.html${page.value}`;
    document.getElementById("openSite").href = `index.html${page.value}`;
  });
  sample.addEventListener("input", () => { document.getElementById("sampleOutput").textContent = sample.value; });
  document.getElementById("sampleOutput").textContent = sample.value;
  document.getElementById("resetFont").addEventListener("click", () => api.reset());
  document.getElementById("downloadFont").addEventListener("click", () => {
    const url = URL.createObjectURL(new Blob([api.settingsSource()], { type: "text/javascript;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "font-settings.js";
    link.hidden = true;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  update();
})();
