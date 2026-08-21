const state = { projects: [], selected: 0, isProjectView: false };

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

async function fetchProjects() {
  const response = await fetch("data/projects.json", { cache: "no-store" });
  if (!response.ok) throw new Error(`Unable to load projects (${response.status})`);
  return response.json();
}

function projectUrl(project) {
  return `#project/${encodeURIComponent(project.slug)}`;
}

function getProjectIndexFromHash() {
  const match = window.location.hash.match(/^#project\/(.+)$/);
  if (!match) return 0;
  const slug = decodeURIComponent(match[1]);
  const index = state.projects.findIndex((project) => project.slug === slug);
  return index >= 0 ? index : 0;
}

function getRoute() {
  return window.location.hash.startsWith("#project/") ? "project" : "home";
}

function renderCarousel() {
  const carousel = document.getElementById("projectCarousel");
  if (!carousel) return;

  carousel.innerHTML = state.projects.map((project, index) => `
    <button class="project-card ${index === state.selected ? "is-selected" : ""}"
            type="button"
            data-index="${index}">
      <span class="project-count">${String(index + 1).padStart(2, "0")}</span>
      <img src="${escapeHtml(project.image)}" alt="${escapeHtml(project.title)} preview">
      <span class="project-card-copy">
        <span class="project-card-title">${escapeHtml(project.title)}</span>
        <span class="project-card-meta">${escapeHtml(project.category)} / ${escapeHtml(project.year)}</span>
      </span>
    </button>
  `).join("");
}

function renderDockCarousel() {
  const carousel = document.getElementById("projectDockCarousel");
  if (!carousel) return;

  carousel.innerHTML = state.projects.map((project, index) => `
    <button class="dock-project-card ${index === state.selected ? "is-selected" : ""}"
            type="button"
            data-index="${index}">
      <img src="${escapeHtml(project.image)}" alt="${escapeHtml(project.title)} preview">
      <span>
        <strong>${escapeHtml(project.title)}</strong>
        <small>${escapeHtml(project.category)} / ${escapeHtml(project.year)}</small>
      </span>
    </button>
  `).join("");
}

function layoutCarousel() {
  const cards = Array.from(document.querySelectorAll(".project-card"));
  const dockCards = Array.from(document.querySelectorAll(".dock-project-card"));
  const count = state.projects.length || cards.length || dockCards.length;
  if (!count) return;

  cards.forEach((card, index) => {
    const selected = index === state.selected;
    card.classList.toggle("is-selected", selected);
    card.setAttribute("aria-pressed", String(selected));
  });
  if (cards.length) {
    centerCardInScroller(document.getElementById("projectCarousel"), cards[state.selected]);
  }

  dockCards.forEach((card, index) => {
    card.classList.toggle("is-selected", index === state.selected);
  });
  if (dockCards.length) {
    centerCardInScroller(document.getElementById("projectDockCarousel"), dockCards[state.selected]);
  }
}

function centerCardInScroller(scroller, card) {
  if (!scroller || !card) return;

  const target = card.offsetLeft - (scroller.clientWidth - card.offsetWidth) / 2;
  scroller.scrollTo({ left: Math.max(0, target), behavior: "smooth" });
}

function scrollToProjectHero(behavior = "smooth") {
  window.scrollTo({ top: 0, behavior });
}

function settleProjectHeroScroll(behavior = "smooth") {
  window.requestAnimationFrame(() => {
    scrollToProjectHero(behavior);
    window.setTimeout(() => scrollToProjectHero("auto"), behavior === "smooth" ? 320 : 80);
  });
}

function renderProjectPage() {
  const mount = document.getElementById("projectPage");
  const project = state.projects[state.selected];
  if (!mount || !project) return;

  const tags = (project.tags || []).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  const specs = (project.specs || []).map((spec) => `
    <div class="report-stat">
      <dt>${escapeHtml(spec.label)}</dt>
      <dd>${escapeHtml(spec.value)}</dd>
    </div>
  `).join("");
  const heroLinks = (project.links || []).filter((link) => !/report|presentation|slides/i.test(link.label || ""));
  const documentLinks = (project.links || []).filter((link) => /report|presentation|slides/i.test(link.label || ""));
  const heroActions = heroLinks.map((link) => `
    <a class="project-link-button" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">
      ${escapeHtml(link.label)}
    </a>
  `).join("");
  const documentActions = documentLinks.map((link) => `
    <a class="project-link-button project-link-button-dark" href="${escapeHtml(link.href)}" target="_blank" rel="noopener noreferrer">
      ${escapeHtml(link.label)}
    </a>
  `).join("");
  const references = (project.references || ["Primary project artefacts are linked below where available."]).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const disclosures = (project.disclosures || ["Summarised for portfolio presentation; third-party assets, datasets, and tools remain with their respective owners."]).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const gallery = project.gallery || [];
  const projectImage = { src: project.image, alt: `${project.title} project image` };
  const specContext = (project.specs || [])
    .slice(0, 3)
    .map((spec) => `${spec.label.toLowerCase()}: ${spec.value}`)
    .join("; ");
  const resultSpec = (project.specs || []).find((spec) => /result|output|speed|scale|outcome/i.test(spec.label));
  const tagContext = (project.tags || []).join(", ");
  const recognitionItems = [
    ...(project.recognitions || []),
    ...(project.tags || []).filter((tag) => /dean|award|list|competition|final year/i.test(tag)),
    ...(resultSpec ? [`${resultSpec.label}: ${resultSpec.value}`] : [])
  ];
  const recognitions = (recognitionItems.length ? recognitionItems : ["Selected project for portfolio presentation."])
    .map((item) => `<li>${escapeHtml(item)}</li>`)
    .join("");

  function reportFigure(item) {
    return `
      <figure class="report-figure">
        <img src="${escapeHtml(item.src)}" alt="${escapeHtml(item.alt || project.title)}">
      </figure>
    `;
  }

  function galleryItem(index) {
    return gallery[index] || gallery[index - 1] || gallery[0] || projectImage;
  }

  const reportSections = [
    {
      label: "Robot",
      image: galleryItem(0),
      paragraphs: [
        project.sections?.[0]?.body || project.description,
        `This section introduces the physical system and the constraints it had to satisfy. For ${project.title}, the important question was not only what the object looked like, but how the platform, sensing, interface, and build decisions supported the intended interaction.`,
        specContext ? `The core specification was anchored by ${specContext}. These details define the operating envelope before the task logic or evaluation layer is considered.` : `The core specification was shaped by the available hardware, implementation time, and the need to make the finished system legible to a reviewer.`
      ]
    },
    {
      label: "Task",
      image: galleryItem(1),
      paragraphs: [
        project.subtitle,
        project.sections?.[1]?.body || project.description,
        `The task was framed around a clear user-facing outcome: make the system understandable, repeatable, and easy to evaluate. That meant translating the broad project idea into a sequence of behaviours, interfaces, and success criteria that could be demonstrated without needing extra explanation.`
      ]
    },
    {
      label: "Control",
      image: galleryItem(2),
      paragraphs: [
        project.sections?.[2]?.body || `The control layer connects the project intent to the working implementation. In practice this meant coordinating data flow, decision logic, interfaces, and feedback so that the system behaved consistently rather than only working in isolated demos.`,
        specContext ? `The relevant technical structure included ${specContext}. Where appropriate, this section is where theory, plots, algorithms, or control diagrams sit so the page can explain why the implementation behaves the way it does.` : `Where appropriate, this section is where theory, plots, algorithms, or control diagrams sit so the page can explain why the implementation behaves the way it does.`,
        tagContext ? `The implementation is connected to ${tagContext}, which gives the project its technical identity and helps distinguish the control problem from the broader presentation layer.` : `The implementation choices give the project its technical identity and separate the control problem from the broader presentation layer.`
      ]
    },
    {
      label: "Results",
      image: galleryItem(3),
      paragraphs: [
        project.sections?.[3]?.body || project.description,
        resultSpec ? `The clearest measured result was ${resultSpec.label.toLowerCase()}: ${resultSpec.value}. This is treated as the headline outcome because it turns the project from a build exercise into something that can be compared, inspected, or defended.` : `The result is presented through the finished behaviour, the supporting artefacts, and the evidence that the system could carry the intended task end to end.`,
        `The final page keeps the outcome close to the implementation details so a recruiter can quickly see what was built, what role it served, and what evidence supports the claim.`
      ]
    }
  ];

  const reportSectionMarkup = reportSections.map((section, index) => `
    <section class="report-section report-split ${index % 2 ? "report-split-reverse" : ""}">
      ${index % 2 ? "" : reportFigure(section.image)}
      <div class="report-copy">
        <p class="section-label">${escapeHtml(section.label)}</p>
        ${section.paragraphs.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("")}
      </div>
      ${index % 2 ? reportFigure(section.image) : ""}
    </section>
  `).join("");

  mount.style.setProperty("--accent", project.accent || "#fff");
  mount.innerHTML = `
    <div class="project-hero">
      <video class="project-hero-video" autoplay muted loop playsinline poster="${escapeHtml(project.image)}">
        <source src="${escapeHtml(project.heroVideo || "")}" type="video/mp4">
      </video>
      <div class="project-hero-shade"></div>
      <div class="project-hero-copy">
        <p class="kicker">${escapeHtml(project.category)} / ${escapeHtml(project.year)}</p>
        <h2>${escapeHtml(project.title)}</h2>
        <p>${escapeHtml(project.subtitle)}</p>
        ${heroActions ? `<div class="project-actions">${heroActions}</div>` : ""}
      </div>
    </div>

    <div class="project-body">
      ${reportSectionMarkup}

      <section class="report-section report-recognition">
        <p class="section-label">Recognitions</p>
        <ul>${recognitions}</ul>
        <div class="tag-row">${tags}</div>
        <dl class="report-stats">${specs}</dl>
      </section>

      <section class="report-section report-notes">
        <div>
          <p class="section-label">References</p>
          <ul>${references}</ul>
        </div>
        <div>
          <p class="section-label">Disclosures</p>
          <ul>${disclosures}</ul>
        </div>
      </section>

      ${documentActions ? `
        <section class="report-section report-links">
          <p class="section-label">Links</p>
          <div class="project-actions">${documentActions}</div>
        </section>
      ` : ""}
    </div>
  `;

  document.title = `${project.title} | Dylan Winters`;
}

function renderHomePage() {
  state.isProjectView = false;
  document.body.classList.remove("is-project-view");
  document.body.classList.remove("is-carousel-open");
  document.body.classList.remove("is-project-dock-open");
  const mount = document.getElementById("projectPage");
  if (mount) mount.innerHTML = "";
  document.title = "Dylan Winters | Projects";
  layoutCarousel();
}

function focusCarouselProject(index) {
  const count = state.projects.length;
  if (!count) return;
  state.selected = (index % count + count) % count;
  layoutCarousel();
}

function selectProject(index, options = {}) {
  const count = state.projects.length;
  if (!count) return;
  state.isProjectView = true;
  state.selected = (index % count + count) % count;
  document.body.classList.add("is-project-view");
  document.body.classList.remove("is-carousel-open");
  document.body.classList.remove("is-project-dock-open");
  layoutCarousel();
  renderProjectPage();

  const project = state.projects[state.selected];
  if (!options.fromHash && project) {
    history.pushState(null, "", projectUrl(project));
    settleProjectHeroScroll("smooth");
  }
}

function bindInteractions() {
  const carousel = document.getElementById("projectCarousel");
  const dock = document.getElementById("projectDock");
  const dockCarousel = document.getElementById("projectDockCarousel");
  const jumpButton = document.getElementById("projectJumpButton");

  carousel?.addEventListener("click", (event) => {
    const card = event.target.closest(".project-card");
    if (!card) return;

    selectProject(Number(card.dataset.index));
  });

  jumpButton?.addEventListener("click", () => {
    document.body.classList.toggle("is-project-dock-open");
  });

  dock?.addEventListener("pointerenter", () => {
    document.body.classList.add("is-project-dock-open");
  });

  dock?.addEventListener("pointerleave", () => {
    document.body.classList.remove("is-project-dock-open");
  });

  dockCarousel?.addEventListener("click", (event) => {
    const card = event.target.closest(".dock-project-card");
    if (!card) return;

    selectProject(Number(card.dataset.index));
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape") document.body.classList.remove("is-project-dock-open");
    if (event.key === "ArrowLeft") focusCarouselProject(state.selected - 1);
    if (event.key === "ArrowRight") focusCarouselProject(state.selected + 1);
  });
  document.getElementById("prevProject")?.addEventListener("click", () => focusCarouselProject(state.selected - 1));
  document.getElementById("nextProject")?.addEventListener("click", () => focusCarouselProject(state.selected + 1));
  window.addEventListener("hashchange", () => {
    if (getRoute() === "project") selectProject(getProjectIndexFromHash(), { fromHash: true });
    else renderHomePage();
  });
  window.addEventListener("resize", () => {
    layoutCarousel();
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    state.projects = await fetchProjects();
    state.selected = getProjectIndexFromHash();
    renderCarousel();
    renderDockCarousel();
    layoutCarousel();
    bindInteractions();
    if (getRoute() === "project") {
      selectProject(state.selected, { fromHash: true });
      settleProjectHeroScroll("auto");
    } else {
      renderHomePage();
      if (!window.location.hash) history.replaceState(null, "", "#home");
    }
  } catch (error) {
    console.error(error);
    const mount = document.getElementById("projectPage");
    if (mount) mount.innerHTML = `<p class="load-error">Unable to load projects.</p>`;
  }
});
