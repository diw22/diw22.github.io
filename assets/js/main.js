"use strict";

const state = { projects: [], route: "", scroll: new Map(), media: new Map() };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value = "") => String(value).replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));
const projectUrl = (project, story = false) => `#project/${encodeURIComponent(project.slug)}${story ? "/story" : ""}`;
const entryUrl = (project) => project.entryHref || projectUrl(project);
const title = (project) => project.displayTitle || project.title;
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

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

function mediaItems(project) {
  const first = project.heroVideo
    ? { type: "video", src: project.heroVideo, poster: project.heroPoster || project.image, alt: `${project.title} demonstration` }
    : { src: project.image, alt: `${project.title} overview` };
  return [first, ...(project.gallery || []), ...(project.extraGallery || [])]
    .filter((item, index, items) => items.findIndex((other) => other.src === item.src) === index);
}

function mediaMarkup(item, { hero = false } = {}) {
  const video = item.type === "video" || /\.(mp4|webm|ogg)$/i.test(item.src);
  return video
    ? `<video controls autoplay muted loop playsinline preload="metadata" ${item.poster ? `poster="${escapeHtml(item.poster)}"` : ""} aria-label="${escapeHtml(item.alt)}"><source src="${escapeHtml(item.src)}" type="${/\.webm$/i.test(item.src) ? "video/webm" : "video/mp4"}"></video>`
    : `<img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt)}" ${hero ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
}

let cancelMediaSlide = () => {};

function renderMedia(project, index, { animate = false, direction = 1 } = {}) {
  cancelMediaSlide();
  const items = mediaItems(project);
  const active = Math.max(0, Math.min(index, items.length - 1));
  state.media.set(project.slug, active);
  const mount = $("#projectMedia");
  const previous = mount.firstElementChild;
  const incoming = document.createElement("div");
  incoming.className = "media-slide";
  incoming.innerHTML = mediaMarkup(items[active], { hero: true });
  if (animate && previous && !reducedMotion.matches) {
    previous.inert = true;
    previous.setAttribute("aria-hidden", "true");
    previous.querySelector("video")?.pause();
    mount.append(incoming);
    const timing = { duration: 750, easing: "cubic-bezier(.22, 1, .36, 1)", fill: "both" };
    const outgoingAnimation = previous.animate([
      { transform: "translateX(0)" }, { transform: `translateX(${-direction * 12}%)` }
    ], timing);
    const incomingAnimation = incoming.animate([
      { transform: `translateX(${direction * 100}%)` }, { transform: "translateX(0)" }
    ], timing);
    const finish = () => {
      previous.remove();
      outgoingAnimation.cancel();
      incomingAnimation.cancel();
      if (cancelMediaSlide === finish) cancelMediaSlide = () => {};
    };
    cancelMediaSlide = finish;
    incomingAnimation.finished.then(finish, () => {});
  } else mount.replaceChildren(incoming);
  $("#mediaCaption").textContent = items[active].alt;
}

function projectNavigation(project) {
  return `<nav class="project-navigation" aria-label="Project navigation">
    <a class="back-link" href="#work"><span aria-hidden="true">←</span> All projects</a>
    <a class="project-open" href="${escapeHtml(entryUrl(project))}">View project <span aria-hidden="true">↗</span></a>
  </nav>`;
}

function nextProjectMarkup(project) {
  const available = state.projects.filter((item) => item.status !== "draft");
  const index = available.findIndex((item) => item.slug === project.slug);
  const next = available[(index + 1) % available.length];
  return `<nav class="next-project" aria-label="Continue exploring">
    <a class="text-link" href="#work">← All projects</a>
    <a class="next-project-link" href="${escapeHtml(entryUrl(next))}" aria-label="Next project: ${escapeHtml(title(next))}"><span>${escapeHtml(title(next))} <span aria-hidden="true">↗</span></span></a>
  </nav>`;
}

function renderExperience(project) {
  const items = mediaItems(project);
  return `<section class="project-experience" aria-label="${escapeHtml(project.title)} media">
    <figure class="media-stage"><div id="projectMedia"></div><figcaption class="sr-only" id="mediaCaption" aria-live="polite"></figcaption></figure>
    ${items.length > 1 ? `<nav class="media-navigation" aria-label="Browse project media">
      <button type="button" data-media-step="-1" aria-label="Previous image or video">←</button>
      <button type="button" data-media-step="1" aria-label="Next image or video">→</button>
    </nav>` : ""}
  </section>`;
}

reducedMotion.addEventListener("change", () => { if (reducedMotion.matches) cancelMediaSlide(); });

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
      <section class="story-resources" id="story-resources"><h2 tabindex="-1">${resourcesLabel}</h2>${links.length ? `<div class="resource-links">${links.map((link) => `<a class="text-link" href="${escapeHtml(link.href)}" ${link.href.startsWith("playground/") ? "" : 'target="_blank" rel="noopener noreferrer"'}>${escapeHtml(link.label)} <span aria-hidden="true">↗</span></a>`).join("")}</div>` : ""}
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
        <a class="back-link" href="#work"><span aria-hidden="true">←</span> All projects</a>
        <h1 tabindex="-1">${escapeHtml(title(project))}</h1>
        <a class="experience-details" href="${projectUrl(project, true)}">Project details <span aria-hidden="true">↗</span></a>
      </header>${renderExperience(project)}`;
  if (!story) renderMedia(project, state.media.get(project.slug) || 0);
  document.title = `${title(project)}${story ? " — Project details" : ""} | Dylan Winters`;
}

function renderRoute({ initial = false, immediate = false } = {}) {
  cancelMediaSlide();
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
    $("#projectView").innerHTML = '<section class="not-found"><h1 tabindex="-1">Project not found.</h1><p>This project may have moved. The collection is a good place to start.</p><a class="pill-button" href="#work">← All projects</a></section>';
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
    const media = event.target.closest("[data-media-step]");
    if (media) {
      const project = state.projects.find((item) => item.slug === $("#projectView").dataset.project);
      if (project) {
        const count = mediaItems(project).length;
        const next = ((state.media.get(project.slug) || 0) + Number(media.dataset.mediaStep) + count) % count;
        renderMedia(project, next, { animate: true, direction: Number(media.dataset.mediaStep) });
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
