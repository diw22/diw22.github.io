/* Cross-document hooks must be registered in the head before the first render.
   https://developer.chrome.com/docs/web-platform/view-transitions/cross-document */
(() => {
  const root = document.documentElement;
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  let active, entrance, version = 0, historyIndex = window.navigation?.currentEntry?.index;

  function depth(value) {
    const url = new URL(value, location.href);
    if (url.hash.startsWith("#project/")) return url.hash.endsWith("/story") ? 3 : 2;
    if (/\/(playground|rigby|smoke-and-mirrors|market-making)\/(?:index\.html)?$/.test(url.pathname)) return 2;
    if (/\/(privacy|terms)\.html$/.test(url.pathname)) return 2;
    return !url.hash || url.hash === "#home" ? 0 : 1;
  }
  function direction(from, to) {
    const project = (value) => {
      const url = new URL(value, location.href);
      return url.hash.match(/^#project\/([^/]+)/)?.[1] || url.pathname.match(/\/(playground|rigby|smoke-and-mirrors|market-making)\/(?:index\.html)?$/)?.[1];
    };
    const previousProject = project(from), nextProject = project(to);
    if (previousProject && nextProject && previousProject !== nextProject) return "forward";
    return depth(to) < depth(from) ? "backward" : "forward";
  }
  function cancel() {
    version++;
    active?.skipTransition();
    entrance?.cancel();
    active = null;
    delete root.dataset.routeTransition;
    root.classList.remove("route-entering");
  }
  function track(transition, fallback) {
    active = transition;
    transition.ready.catch(() => {
      // If snapshots are unavailable, still slide the rendered destination in.
      if (active === transition && !motion.matches) fallback?.();
    });
    transition.finished.catch(() => {}).finally(() => {
      if (active !== transition) return;
      active = null;
      delete root.dataset.routeTransition;
    });
  }
  function enter(side) {
    if (motion.matches || !document.body) return;
    entrance?.cancel();
    root.classList.add("route-entering");
    const animation = document.body.animate([
      { transform: `translateY(${side === "backward" ? -100 : 100}vh)` },
      { transform: "translateY(0)" }
    ], { duration: 750, easing: "cubic-bezier(.22, 1, .36, 1)" });
    entrance = animation;
    animation.finished.catch(() => {}).finally(() => {
      if (entrance !== animation) return;
      root.classList.remove("route-entering");
    });
  }
  function navigate(render, from, to) {
    cancel();
    if (motion.matches || from === to) { render(); return; }
    const nextIndex = window.navigation?.currentEntry?.index;
    const side = nextIndex < historyIndex ? "backward" : direction(from, to);
    historyIndex = nextIndex;
    const navigationVersion = version;
    if (document.startViewTransition) {
      root.dataset.routeTransition = side;
      track(document.startViewTransition(() => {
        if (version === navigationVersion) render();
      }), () => enter(side));
    } else { render(); enter(side); }
  }

  window.PortfolioTransitions = { navigate, cancel };
  motion.addEventListener("change", () => { if (motion.matches) cancel(); });

  window.addEventListener("pageswap", (event) => {
    if (!event.viewTransition) return;
    cancel();
    const destination = event.activation?.entry?.url;
    const plainPage = destination && /\/plain\/(?:index\.html)?$/.test(new URL(destination).pathname);
    if (motion.matches || plainPage) { event.viewTransition.ready.catch(() => {}); event.viewTransition.skipTransition(); return; }
    root.dataset.routeTransition = destination ? direction(location.href, destination) : "forward";
    track(event.viewTransition);
  });
  window.addEventListener("pagereveal", (event) => {
    const activation = window.navigation?.activation;
    historyIndex = window.navigation?.currentEntry?.index;
    const from = activation?.from?.url || document.referrer;
    const backwards = activation?.navigationType === "traverse" && activation.entry.index < activation.from?.index;
    const side = backwards ? "backward" : direction(from || location.href, location.href);
    if (!event.viewTransition) {
      if (from && new URL(from).origin === location.origin && from !== location.href) enter(side);
      return;
    }
    cancel();
    if (motion.matches) { event.viewTransition.ready.catch(() => {}); event.viewTransition.skipTransition(); return; }
    root.dataset.routeTransition = side;
    track(event.viewTransition, () => enter(side));
  });

  // Older browsers retain normal links and get a lightweight entrance on arrival.
  if (!("onpagereveal" in window)) {
    window.addEventListener("DOMContentLoaded", () => {
      if (!document.referrer) return;
      const from = new URL(document.referrer);
      if (from.origin === location.origin) enter(direction(from.href, location.href));
    }, { once: true });
  }
})();
