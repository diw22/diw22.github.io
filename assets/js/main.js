"use strict";

const state = { projects: [], route: "", scroll: new Map(), sound: false };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const projectUrl = (project, story = false) => `#project/${encodeURIComponent(project.slug)}${story ? "/story" : ""}`;
const entryUrl = (project) => project.entryHref || projectUrl(project);
const title = (project) => project.displayTitle || project.title;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
// Arrows are drawn as SVG in the text colour: the arrow characters can turn into emoji on Windows.
const ICON_BACK = '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M13 8H3m4-4L3 8l4 4"/></svg>';
const ICON_OUT = '<svg class="icon" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="M5 11l6-6M6 5h5v5"/></svg>';

function bindHomeVideo() {
  const video = $(".home-video");
  const cue = $(".home-scroll-cue");
  let playbackUnavailable = false;
  const shouldPlay = () => !$("#homeView").hidden && !document.hidden && !reducedMotion.matches;
  function updateCue() {
    // The downward look occupies this interval in both cybercore encodes.
    const lookingDown = video.currentTime >= 3.2 && video.currentTime < 8.6;
    cue.classList.toggle("is-visible", lookingDown || reducedMotion.matches || playbackUnavailable);
  }
  function update() {
    updateCue();
    if (!shouldPlay()) { video.pause(); return; }
    video.play().then(() => {
      if (!shouldPlay()) video.pause();
    }).catch(() => {
      if (shouldPlay()) { playbackUnavailable = true; updateCue(); }
    });
  }
  video.addEventListener("timeupdate", updateCue);
  video.addEventListener("seeked", updateCue);
  video.addEventListener("playing", () => { playbackUnavailable = false; updateCue(); });
  video.addEventListener("error", () => { playbackUnavailable = true; updateCue(); });
  // Route rendering happens inside a view transition, after hashchange fires.
  new MutationObserver(update).observe($("#homeView"), { attributes: true, attributeFilter: ["hidden"] });
  document.addEventListener("visibilitychange", update);
  reducedMotion.addEventListener("change", update);
  update();
}

function bindPageScroll() {
  let wheelDistance = 0, lastWheel = 0, touchStart;
  function direction() {
    const root = document.documentElement;
    if (root.dataset.routeTransition || root.classList.contains("route-entering")) return 0;
    if (!$("#homeView").hidden && (!location.hash || location.hash === "#home")) return 1;
    if (!$("#work").hidden && /^#work(?:\/|$)/.test(location.hash)) return -1;
    return 0;
  }
  const navigate = (side) => { if (side && side === direction()) location.hash = side > 0 ? "#work" : "#home"; };
  document.addEventListener("wheel", (event) => {
    const side = direction();
    if (!side || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return;
    const now = performance.now();
    if (now - lastWheel > 200 || event.deltaY * side <= 0) wheelDistance = 0;
    lastWheel = now;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? innerHeight : 1;
    wheelDistance += Math.max(0, event.deltaY * side * unit);
    if (wheelDistance >= 60) { wheelDistance = 0; navigate(side); }
  }, { passive: true });
  document.addEventListener("touchstart", (event) => {
    const touch = event.touches[0], side = direction();
    touchStart = side && event.touches.length === 1 ? { x: touch.clientX, y: touch.clientY, id: touch.identifier, side } : null;
  }, { passive: true });
  document.addEventListener("touchend", (event) => {
    const start = touchStart;
    touchStart = null;
    const end = [...event.changedTouches].find((touch) => touch.identifier === start?.id);
    if (!start || !end) return;
    const distance = (start.y - end.clientY) * start.side;
    if (distance >= 60 && distance > Math.abs(start.x - end.clientX)) navigate(start.side);
  }, { passive: true });
  document.addEventListener("touchcancel", () => { touchStart = null; }, { passive: true });
  document.addEventListener("keydown", (event) => {
    const side = direction();
    if (!side || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
    if (event.target.closest("a, button, input, textarea, select, [contenteditable]")) return;
    const keys = side > 0 ? ["ArrowDown", "PageDown", " "] : ["ArrowUp", "PageUp"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    navigate(side);
  });
  window.addEventListener("hashchange", () => { wheelDistance = 0; touchStart = null; });
}

const isVideo = (item) => item.type === "video" || /\.(mp4|webm|ogg)$/i.test(item.src);
const externalLink = (href) => /^(https?:|.*\.pdf$)/i.test(href);

function mediaMarkup(item) {
  return isVideo(item)
    ? `<video controls autoplay muted loop playsinline preload="metadata" ${item.poster ? `poster="${escapeHtml(item.poster)}"` : ""} aria-label="${escapeHtml(item.alt)}"><source src="${escapeHtml(item.src)}" type="${/\.webm$/i.test(item.src) ? "video/webm" : "video/mp4"}"></video>`
    : `<img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt)}" loading="lazy" decoding="async">`;
}

// A project page is its film, full screen and looping. It can open partway in (ChessBot's starts at the robot,
// after its simulations) and then loops back to there. With reduced motion it waits on its poster with controls.
function renderFilm(project) {
  const item = project.heroVideo
    ? { type: "video", src: project.heroVideo, poster: project.heroPoster || project.image, alt: project.heroAlt || `${project.title} demonstration`, start: project.heroStart }
    : { src: project.image, alt: `${project.title} overview` };
  const mount = $("#projectMedia");
  $("#projectView").dataset.media = isVideo(item) ? "video" : "image";
  mount.innerHTML = isVideo(item)
    ? `<video class="media-cover" ${reducedMotion.matches ? "controls" : "autoplay"} muted ${item.start ? "" : "loop"} playsinline preload="auto" ${item.poster ? `poster="${escapeHtml(item.poster)}"` : ""} aria-label="${escapeHtml(item.alt)}"><source src="${escapeHtml(item.src)}${item.start ? `#t=${item.start}` : ""}" type="${/\.webm$/i.test(item.src) ? "video/webm" : "video/mp4"}"></video>`
    : `<img class="media-contain" src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt)}" fetchpriority="high" decoding="async">`;
  const video = mount.querySelector("video");
  if (!video) return;
  video.muted = !state.sound;
  video.addEventListener("volumechange", () => setSound(!video.muted));
  if (item.start) {
    const toStart = () => { video.currentTime = item.start; };
    if (video.readyState >= 1) toStart(); else video.addEventListener("loadedmetadata", toStart, { once: true });
    video.addEventListener("ended", () => { toStart(); video.play().catch(() => {}); });
  }
  if (!reducedMotion.matches) startFilm(video);
  setSound(state.sound);
}

// Browsers can refuse to play with sound until the visitor has clicked on the site; then it plays muted instead.
function startFilm(video) {
  video.play().catch(() => {
    if (video.muted) return;
    video.muted = true;
    video.play().catch(() => {});
  });
}

// Sound stays as the visitor last set it while they move between project films.
function setSound(on) {
  state.sound = on;
  const button = $("[data-film-sound]");
  if (button) button.setAttribute("aria-pressed", String(on));
}

function projectNavigation(project) {
  return `<nav class="project-navigation" aria-label="Project navigation">
    <a class="back-link" href="#work">${ICON_BACK} All projects</a>
    <a class="project-open" href="${escapeHtml(entryUrl(project))}">View project ${ICON_OUT}</a>
  </nav>`;
}

function nextProjectMarkup(project) {
  const available = state.projects.filter((item) => item.status !== "draft");
  const index = available.findIndex((item) => item.slug === project.slug);
  const next = available[(index + 1) % available.length];
  return `<nav class="next-project" aria-label="Continue exploring">
    <a class="text-link" href="#work">${ICON_BACK} All projects</a>
    <a class="next-project-link" href="${escapeHtml(entryUrl(next))}" aria-label="Next project: ${escapeHtml(title(next))}"><span>${escapeHtml(title(next))} ${ICON_OUT}</span></a>
  </nav>`;
}

function renderExperience(project) {
  const links = project.links || [];
  return `<section class="project-experience" aria-label="${escapeHtml(project.title)} film">
    <figure class="media-stage"><div id="projectMedia"></div></figure>
    <nav class="experience-actions" aria-label="More about ${escapeHtml(project.title)}">
      <a class="experience-button" href="${projectUrl(project, true)}">Project details</a>
      ${links.map((link) => `<a class="experience-button" href="${escapeHtml(link.href)}" ${externalLink(link.href) ? 'target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(link.label)} ${ICON_OUT}</a>`).join("")}
      ${project.heroVideo ? `<button class="experience-button experience-sound" type="button" data-film-sound aria-pressed="false" aria-label="Sound" title="Sound">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path class="sound-on" d="M15.5 9.2a4 4 0 0 1 0 5.6M18.2 6.6a7.6 7.6 0 0 1 0 10.8"/><path class="sound-off" d="m16 9.5 5 5m0-5-5 5"/></svg>
      </button>` : ""}
    </nav>
  </section>`;
}

function renderStory(project) {
  const sections = project.sections || [];
  const gallery = [...(project.gallery || []), ...(project.extraGallery || [])];
  const specs = project.specs || [];
  const notes = [...(project.references || []), ...(project.disclosures || [])];
  const links = project.links || [];
  const resourcesLabel = links.length ? "Links" : "Project details";
  return `<div class="story-layout">
    <aside class="story-index"><nav aria-label="Story chapters"><button type="button" data-section="story-overview">Overview</button>${sections.map((section, index) => `<button type="button" data-section="chapter-${index}">${escapeHtml(section.title)}</button>`).join("")}<button type="button" data-section="story-resources">${resourcesLabel}</button></nav></aside>
    <div class="story-content">
      <section class="story-overview" id="story-overview" aria-labelledby="overview-title"><h2 id="overview-title" tabindex="-1">${escapeHtml(project.subtitle)}</h2><p>${escapeHtml(project.description)}</p></section>
      ${sections.map((section, index) => `<section class="story-chapter" id="chapter-${index}"><div class="chapter-heading"><h2 tabindex="-1">${escapeHtml(section.title)}</h2></div><p>${escapeHtml(section.body)}</p>${gallery[index] ? `<figure class="story-figure">${mediaMarkup(gallery[index])}</figure>` : ""}</section>`).join("")}
      ${gallery.length > sections.length ? `<section class="story-gallery" aria-label="More project images">${gallery.slice(sections.length).map((item) => `<figure class="story-figure">${mediaMarkup(item)}</figure>`).join("")}</section>` : ""}
      <section class="story-resources" id="story-resources"><h2 tabindex="-1">${resourcesLabel}</h2>${links.length ? `<div class="resource-links">${links.map((link) => `<a class="text-link" href="${escapeHtml(link.href)}" ${externalLink(link.href) ? 'target="_blank" rel="noopener noreferrer"' : ""}>${escapeHtml(link.label)} ${ICON_OUT}</a>`).join("")}</div>` : ""}
        ${specs.length || notes.length ? `<details class="project-notes"><summary>Technical details</summary>
          ${specs.length ? `<dl class="project-specs">${specs.map((spec) => `<div><dt>${escapeHtml(spec.label)}</dt><dd>${escapeHtml(spec.value)}</dd></div>`).join("")}</dl>` : ""}
          ${notes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}</details>` : ""}
      </section>
    </div>
  </div>`;
}

function renderProject(project, story) {
  const mount = $("#projectView");
  mount.dataset.project = project.slug;
  mount.innerHTML = story
    ? `${projectNavigation(project)}
      <header class="project-heading"><h1 tabindex="-1">${escapeHtml(title(project))}</h1></header>
      ${renderStory(project)}${nextProjectMarkup(project)}`
    : `<header class="experience-header">
        <a class="back-link" href="#work">${ICON_BACK} All projects</a>
        <h1 tabindex="-1">${escapeHtml(title(project))}</h1>
      </header>${renderExperience(project)}`;
  if (!story) renderFilm(project);
  document.title = `${title(project)}${story ? " — Project details" : ""} | Dylan Winters`;
}

function renderRoute({ initial = false, immediate = false } = {}) {
  const hash = location.hash || "#home";
  const match = hash.match(/^#project\/([^/]+)(\/story)?$/);
  let project;
  if (match) {
    try { project = state.projects.find((item) => item.slug === decodeURIComponent(match[1])); } catch { /* Recoverable unknown-project view. */ }
  }
  if (project?.status === "draft") {
    location.replace(`#work/${encodeURIComponent(project.slug)}`);
    return;
  }
  if (project?.entryHref && !match[2]) { location.replace(project.entryHref); return; }
  const isProject = Boolean(match) || hash.startsWith("#project/");
  const isAbout = hash === "#about";
  const workMatch = hash.match(/^#work(?:\/([^/]+))?$/);
  const isWork = Boolean(workMatch);
  let highlightedProject;
  try { highlightedProject = workMatch?.[1] && decodeURIComponent(workMatch[1]); } catch { /* Invalid selection falls back to the current card. */ }
  const isExperience = Boolean(project && !match[2]);
  document.body.classList.toggle("is-home", !isProject && !isAbout && !isWork);
  document.body.classList.toggle("is-work", isWork);
  document.body.classList.toggle("is-about", isAbout);
  document.body.classList.toggle("is-experience", isExperience);
  $("#homeView").hidden = isProject || isAbout || isWork;
  $("#work").hidden = !isWork;
  $("#about").hidden = !isAbout;
  $("#projectView").hidden = !isProject;
  // Removing the prior media stops playback when leaving a project.
  if (!isProject) $("#projectView").replaceChildren();
  if (isProject && project) renderProject(project, Boolean(match[2]));
  else if (isProject) {
    $("#projectView").removeAttribute("data-project");
    $("#projectView").innerHTML = `<section class="not-found"><h1 tabindex="-1">Project not found.</h1><p>This project may have moved. The collection is a good place to start.</p><a class="pill-button" href="#work">${ICON_BACK} All projects</a></section>`;
    document.title = "Project not found | Dylan Winters";
  } else document.title = "Dylan Winters — Selected work";
  document.querySelectorAll("[data-nav]").forEach((link) => {
    const active = link.dataset.nav === (hash === "#about" ? "about" : "work");
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  state.route = hash;
  const restoreView = () => {
    if (isWork && highlightedProject) $("project-stage").select?.(highlightedProject);
    const target = isWork ? $("#work-title") : !isProject && hash === "#about" ? $("#about-title") : isProject ? $("#projectView h1") : $("#intro-title");
    if (!initial) target?.focus({ preventScroll: true });
    window.scrollTo({ top: isWork || isAbout || isExperience ? 0 : state.scroll.get(hash) || 0, behavior: "instant" });
  };
  if (immediate) restoreView();
  else requestAnimationFrame(restoreView);
}

function navigateRoute() {
  const from = new URL(state.route || '#home', location.href).href;
  const to = new URL(location.hash || '#home', location.href).href;
  window.PortfolioTransitions.navigate(() => renderRoute({ immediate: true }), from, to);
}

function bindInteractions() {
  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-film-sound]")) {
      const video = $("#projectMedia video");
      setSound(!state.sound);
      if (video) {
        video.muted = !state.sound;
        if (video.paused && !reducedMotion.matches) startFilm(video);
      }
    }
    const chapter = event.target.closest("[data-section]");
    if (chapter) {
      const section = document.getElementById(chapter.dataset.section);
      section?.querySelector("h2")?.focus({ preventScroll: true });
      section?.scrollIntoView({ behavior: reducedMotion.matches ? "instant" : "smooth", block: "start" });
    }
    const link = event.target.closest('a[href^="#"]');
    if (link && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
      if (link.hash === "#main") { event.preventDefault(); $("#main").focus(); return; }
      state.scroll.set(state.route, window.scrollY);
      if (["#work", "#about", "#home"].includes(link.hash)) state.scroll.delete(link.hash);
      if (link.hash === location.hash && ["#work", "#about", "#home"].includes(link.hash)) { event.preventDefault(); renderRoute(); }
    }
  });
  window.addEventListener("hashchange", navigateRoute);
  window.addEventListener("scroll", () => state.scroll.set(state.route, window.scrollY), { passive: true });
}

async function init() {
  try {
    const response = await fetch("data/projects.json", { cache: "no-cache" });
    if (!response.ok) throw new Error(`Unable to load projects (${response.status})`);
    state.projects = await response.json();
    history.scrollRestoration = "manual";
    renderRoute({ initial: true });
  } catch (error) {
    // The project stage works without this data; only the #project/ detail views need it.
    console.error(error);
  }
}

bindInteractions();
renderRoute({ initial: true });
bindHomeVideo();
bindPageScroll();
init();
