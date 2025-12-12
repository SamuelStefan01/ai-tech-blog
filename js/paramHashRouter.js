// js/paramHashRouter.js

export class ParamHashRouter {
  constructor(routes) {
    this.routes = routes;
    window.addEventListener("hashchange", () => this.handle());
    document.addEventListener("DOMContentLoaded", () => this.handle());
  }

  // Parse "#hash?key=value&..." -> { hash, params }
  parseHash(rawHash) {
    const clean = rawHash.replace(/^#/, "") || "welcome";
    const [hash, query] = clean.split("?");
    const params = {};

    if (query) {
      query.split("&").forEach(pair => {
        const [k, v] = pair.split("=");
        if (!k) return;
        params[decodeURIComponent(k)] = decodeURIComponent(v || "");
      });
    }

    return { hash, params };
  }

  // Find route and call its getTemplate
  handle() {
    const { hash, params } = this.parseHash(window.location.hash);
    const route = this.routes.find(r => r.hash === hash) || this.routes[0];
    if (!route || typeof route.getTemplate !== "function") return;

    route.getTemplate(route.target, params);
    this.setDocumentTitle(hash, params);
    this.updateActiveLink(hash);
  }


  setDocumentTitle(hash, params) {
    const base = "AI Tech Blog";
    const titles = {
      welcome: `${base} | Welcome`,
      articles: `${base} | Articles`,
      article: `${base} | Article`,
      addArticle: `${base} | Add Article`
    };

    // include id for article detail
    if (hash === "article" && params && params.id) {
      document.title = `${base} | Article #${params.id}`;
      return;
    }

    document.title = titles[hash] || base;
  }


  // Mark active menu link
  updateActiveLink(hash) {
    const links = document.querySelectorAll(".site-nav a[data-route]");
    links.forEach(link => {
      const isActive = link.getAttribute("data-route") === hash;
      link.classList.toggle("active", isActive);
    });
  }
}