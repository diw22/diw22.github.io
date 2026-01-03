/* =========================
   Helpers
========================= */
function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch ${path} (${res.status})`);
  return res.json();
}

/* =========================
   Experience (modular JSON)
========================= */
function renderExperienceItem(item) {
  const sideClass = item.side === "right" ? "t-right" : "t-left";

  const bullets = (item.bullets || []).map(b => `<li>${escapeHtml(b)}</li>`).join("");
  const tags = (item.tags || []).map(t => `<span class="tag">${escapeHtml(t)}</span>`).join("");

  return `
    <article class="t-item ${sideClass}">
      <div class="t-date">
        <span class="t-month">${escapeHtml(item.month)}</span>
        <span class="t-year">${escapeHtml(item.year)}</span>
      </div>

      <div class="t-card">
        <div class="t-head">
          <div class="t-title">${escapeHtml(item.title)}</div>
          <div class="t-org">${escapeHtml(item.org)}</div>
        </div>

        <div class="t-more">
          <div class="t-more-inner">
            <p class="t-summary">${escapeHtml(item.summary || "")}</p>
            ${bullets ? `<ul>${bullets}</ul>` : ""}
            ${tags ? `<div class="t-tags">${tags}</div>` : ""}
          </div>
        </div>
      </div>
    </article>
  `;
}

async function loadExperience() {
  const mount = document.getElementById("experienceTimeline");
  if (!mount) return;

  try {
    const items = await fetchJson("data/experience.json");
    mount.innerHTML = items.map(renderExperienceItem).join("");

    // Refresh ScrollTrigger calculations after injecting DOM
    if (window.ScrollTrigger) ScrollTrigger.refresh();
  } catch (err) {
    console.error(err);
    mount.innerHTML = `<p style="color:#b9b9b9">Unable to load experience.</p>`;
  }
}

/* =========================
   Projects (modular JSON + filters + modal)
========================= */
const CATEGORY_LABELS = {
  all: "All",
  data: "Data",
  quant: "Quant",
  robotics: "Robotics",
  hardware: "Hardware"
};

function renderProjectCard(p) {
  const cardInner = `
    <div class="project-card"
         data-category="${escapeHtml(p.category)}"
         data-title="${escapeHtml(p.title)}"
         data-desc="${escapeHtml(p.description)}"
         data-image="${escapeHtml(p.image)}"
         ${p.href ? `data-href="${escapeHtml(p.href)}"` : ""}>
      <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.title)} Screenshot">
      <h3>${escapeHtml(p.title)}</h3>
      <p>${escapeHtml(p.description)}</p>
    </div>
  `;

  // Link projects behave exactly like before
  if (p.href) {
    return `
      <a href="${escapeHtml(p.href)}" class="project-link" target="_blank" rel="noopener noreferrer">
        ${cardInner}
      </a>
    `;
  }

  // No href -> keep layout, but open modal
  return `
    <a class="project-link" role="button" tabindex="0">
      ${cardInner}
    </a>
  `;
}

function renderProjectFilters(categories) {
  const filtersEl = document.getElementById("projectsFilters");
  if (!filtersEl) return;

  const preferred = ["data", "quant", "robotics", "hardware"];
  const extras = categories.filter(c => c !== "all" && !preferred.includes(c));
  const finalCats = ["all", ...preferred.filter(c => categories.includes(c)), ...extras];

  filtersEl.innerHTML = finalCats.map((cat, idx) => {
    const label = CATEGORY_LABELS[cat] || (cat.charAt(0).toUpperCase() + cat.slice(1));
    return `<button data-filter="${escapeHtml(cat)}" class="${idx === 0 ? "active" : ""}">${escapeHtml(label)}</button>`;
  }).join("");
}

function applyProjectFilter(filter) {
  const links = document.querySelectorAll("#projectsGrid .project-link");
  links.forEach(link => {
    const card = link.querySelector(".project-card");
    const category = card?.dataset.category;
    const hide = filter !== "all" && category !== filter;
    link.classList.toggle("hidden", hide);
  });
}

function initModal() {
  const modal = document.getElementById("modal");
  const modalClose = document.getElementById("modal-close");

  if (!modal || !modalClose) return;

  modalClose.addEventListener("click", () => modal.classList.remove("show"));
  modal.addEventListener("click", (e) => {
    if (e.target === modal) modal.classList.remove("show");
  });
}

function openProjectModalFromCard(card) {
  const modal = document.getElementById("modal");
  const modalImg = document.getElementById("modal-img");
  const modalTitle = document.getElementById("modal-title");
  const modalDesc = document.getElementById("modal-desc");

  if (!modal || !modalImg || !modalTitle || !modalDesc) return;

  modalImg.src = card.dataset.image || "";
  modalTitle.textContent = card.dataset.title || "";
  modalDesc.textContent = card.dataset.desc || "";
  modal.classList.add("show");
}

async function loadProjects() {
  const grid = document.getElementById("projectsGrid");
  const filtersEl = document.getElementById("projectsFilters");
  if (!grid || !filtersEl) return;

  try {
    const projects = await fetchJson("data/projects.json");

    // Render cards
    grid.innerHTML = projects.map(renderProjectCard).join("");

    // Filters from data
    const cats = Array.from(new Set(projects.map(p => p.category))).filter(Boolean);
    renderProjectFilters(["all", ...cats]);

    // Filter click handler (event delegation)
    filtersEl.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-filter]");
      if (!btn) return;

      filtersEl.querySelector("button.active")?.classList.remove("active");
      btn.classList.add("active");

      applyProjectFilter(btn.dataset.filter);
    });

    // Modal for projects without href (event delegation)
    grid.addEventListener("click", (e) => {
      const card = e.target.closest(".project-card");
      if (!card) return;

      const href = card.dataset.href;
      if (href) return; // let normal <a> click occur

      e.preventDefault();
      openProjectModalFromCard(card);
    });

    if (window.ScrollTrigger) ScrollTrigger.refresh();
  } catch (err) {
    console.error(err);
    grid.innerHTML = `<p style="color:#b9b9b9">Unable to load projects.</p>`;
  }
}

/* =========================
   GSAP Reveal (unchanged)
========================= */
function initReveal() {
  if (!window.gsap || !window.ScrollTrigger) return;

  gsap.registerPlugin(ScrollTrigger);

  document.querySelectorAll(".reveal").forEach(el => {
    gsap.from(el, {
      y: 50,
      opacity: 0,
      duration: 0.6,
      ease: "power2.out",
      scrollTrigger: {
        trigger: el,
        start: "top 80%",
        toggleActions: "play none none none"
      }
    });
  });
}

/* =========================
   Education tabs (unchanged)
========================= */
function initEducationTabs() {
  const eduTabs = document.querySelectorAll(".edu-tab");
  const eduPanels = document.querySelectorAll(".edu-panel");
  if (!eduTabs.length || !eduPanels.length) return;

  eduTabs.forEach(tab => {
    tab.addEventListener("click", () => {
      eduTabs.forEach(t => {
        t.classList.remove("active");
        t.setAttribute("aria-selected", "false");
      });
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");

      const target = tab.dataset.year;
      eduPanels.forEach(p => p.classList.toggle("active", p.id === target));
    });
  });
}

/* =========================
   Design carousel (unchanged)
========================= */
function initDesignCarousel() {
  const designCards = Array.from(document.querySelectorAll(".design-card"));
  const prevBtn = document.querySelector(".design-prev");
  const nextBtn = document.querySelector(".design-next");

  if (!designCards.length) return;

  let centerIndex = 0;

  function clampIndex(i) {
    const n = designCards.length;
    return (i % n + n) % n;
  }

  function layoutDesignCarousel(animate = true, dir = 1) {
    const n = designCards.length;
    if (n === 0) return;

    const leftX = -320;
    const rightX = 320;
    const sideScale = 0.82;
    const sideOpacity = 0.45;
    const sideBlur = 1.5;

    const centerScale = 1.0;
    const centerOpacity = 1.0;
    const centerBlur = 0;

    designCards.forEach(c => c.classList.remove("is-center"));

    for (let i = 0; i < n; i++) {
      const card = designCards[i];
      const offset = ((i - centerIndex) % n + n) % n;

      let state = "hidden";
      if (offset === 0) state = "center";
      else if (offset === 1) state = "right";
      else if (offset === n - 1) state = "left";

      let x = 0, scale = 0.7, opacity = 0, z = 0, blur = 6;

      if (state === "center") {
        x = 0; scale = centerScale; opacity = centerOpacity; z = 3; blur = centerBlur;
        card.classList.add("is-center");
        card.setAttribute("aria-hidden", "false");
        card.tabIndex = 0;
      } else if (state === "left") {
        x = leftX; scale = sideScale; opacity = sideOpacity; z = 2; blur = sideBlur;
        card.setAttribute("aria-hidden", "true");
        card.tabIndex = -1;
      } else if (state === "right") {
        x = rightX; scale = sideScale; opacity = sideOpacity; z = 2; blur = sideBlur;
        card.setAttribute("aria-hidden", "true");
        card.tabIndex = -1;
      } else {
        x = dir > 0 ? rightX * 1.8 : leftX * 1.8;
        scale = 0.72;
        opacity = 0;
        z = 1;
        blur = 8;
        card.setAttribute("aria-hidden", "true");
        card.tabIndex = -1;
      }

      card.style.zIndex = z;

      if (animate && window.gsap) {
        gsap.to(card, {
          duration: 0.45,
          ease: "power3.out",
          x,
          scale,
          opacity,
          filter: `blur(${blur}px)`
        });
      } else {
        card.style.transform = `translateX(calc(-50% + ${x}px)) scale(${scale})`;
        card.style.opacity = opacity;
        card.style.filter = `blur(${blur}px)`;
      }
    }
  }

  function goNext() {
    centerIndex = clampIndex(centerIndex + 1);
    layoutDesignCarousel(true, 1);
  }

  function goPrev() {
    centerIndex = clampIndex(centerIndex - 1);
    layoutDesignCarousel(true, -1);
  }

  function enforceCenterClick() {
    designCards.forEach((card, i) => {
      card.addEventListener("click", (e) => {
        if (i !== centerIndex) {
          e.preventDefault();
          const n = designCards.length;
          const offset = ((i - centerIndex) % n + n) % n;
          if (offset === 1) goNext();
          else if (offset === n - 1) goPrev();
        }
      });
    });
  }

  window.addEventListener("keydown", (e) => {
    if (e.key === "ArrowRight") goNext();
    if (e.key === "ArrowLeft") goPrev();
  });

  nextBtn?.addEventListener("click", goNext);
  prevBtn?.addEventListener("click", goPrev);

  enforceCenterClick();

  designCards.forEach(c => {
    c.style.transform = "translateX(-50%) scale(0.72)";
    c.style.opacity = 0;
    c.style.filter = "blur(8px)";
  });

  layoutDesignCarousel(true, 1);
}

/* =========================
   Boot
========================= */
document.addEventListener("DOMContentLoaded", async () => {
  initModal();
  initReveal();
  initEducationTabs();
  initDesignCarousel();

  // Load data-driven sections
  await loadExperience();
  await loadProjects();
});
