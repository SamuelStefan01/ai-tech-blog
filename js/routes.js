import { ArticleFormsHandler } from "./articleFormsHandler.js";

const WT_BASE_URL = "https://wt.kpi.fei.tuke.sk/api";
// Netlify-only: we proxy WT through a Netlify Function to bypass browser CORS.
// On Netlify deployment, requests go to /api/* (see netlify.toml redirect) -> /.netlify/functions/wtProxy
const PROXY_BASE_URL = "/api";
const isNetlify = location.hostname.endsWith(".netlify.app");
const isNetlifyDev = location.hostname === "localhost" && (location.port === "8888" || location.port === "9999");
const BASE_URL = (isNetlify || isNetlifyDev) ? PROXY_BASE_URL : WT_BASE_URL;
const articleFormsHandler = new ArticleFormsHandler(BASE_URL);
const API_COOLDOWN_KEY = "wt_api_cooldown_until";

// ===== Resilient fetch helpers (timeout + retry + cache) =====
const ARTICLES_CACHE_KEY = "articles_cache_v1";
const API_TIMEOUT_MS = 65000; // 65s client timeout

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchTextWithTimeout(url, ms = API_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    const text = await res.text();
    return { res, text };
  } finally {
    clearTimeout(t);
  }
}

function setArticlesState(target, state, extra = {}) {
  if (!target) return;

  if (state === "loading") {
    target.innerHTML = "<section id=\"articles\"><h2>Články</h2><p>Loading articles…</p></section>";
    return;
  }

  if (state === "empty") {
    target.innerHTML = "<section id=\"articles\"><h2>Články</h2><p>No articles available.</p></section>";
    return;
  }

  if (state === "error_cached") {
    target.innerHTML =
      "<section id=\"articles\"><h2>Články</h2><p>API is down. Showing cached articles.</p></section>";
    return;
  }

  if (state === "error") {
    // If there is a template, caller will render it; this is a fallback.
    target.innerHTML =
      "<section id=\"articles\"><h2>Články</h2><p>Nepodarilo sa načítať články zo servera.</p><button id=\"retry-load-articles\" type=\"button\">Retry</button></section>";
    const btn = document.getElementById("retry-load-articles");
    if (btn) btn.addEventListener("click", () => extra.onRetry && extra.onRetry());
  }
}


async function loadFallbackArticles(offset = 0) {
  const res = await fetch("./data/articles_fallback.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`Fallback HTTP ${res.status}`);
  const data = await res.json();

  // simulate pagination fields your template expects
  if (data.meta) data.meta.offset = offset;
  return JSON.stringify(data);
}


// Local fallback (keeps the site usable when WT API is down)
const FALLBACK_JSON_URL = "./data/articles_fallback.json";

async function loadFallbackResponseText(pageSize, offset) {
  const res = await fetch(FALLBACK_JSON_URL, { cache: "no-store" });
  if (!res.ok) throw new Error(`Fallback HTTP ${res.status}`);
  const all = await res.json();
  const total = Array.isArray(all.articles) ? all.articles.length : 0;
  const slice = (all.articles || []).slice(offset, offset + pageSize);
  const shaped = { articles: slice, meta: { totalCount: total } };
  return JSON.stringify(shaped);
}

// ===== Routes config for SPA =====

export const routes = [
  {
    hash: "welcome",
    target: "router-view",
    getTemplate: (targetElm) => {
      const target = document.getElementById(targetElm);
      const tpl = document.getElementById("template-welcome");
      target.innerHTML = tpl ? tpl.innerHTML : "<p>Missing welcome template.</p>";
    }
  },
  {
    hash: "articles",
    target: "router-view",
    getTemplate: (targetElm, params) => {
      fetchAndDisplayArticles(targetElm, params);
    }
  },
  {
    hash: "article",
    target: "router-view",
    getTemplate: (targetElm, params) => {
      fetchAndDisplayArticleDetail(targetElm, params);
    }
  },
  {
    hash: "opinions",
    target: "router-view",
    getTemplate: (targetElm) => {
      createHtml4opinions(targetElm);
    }
  },
  {
    hash: "addOpinion",
    target: "router-view",
    getTemplate: (targetElm) => {
      const target = document.getElementById(targetElm);
      const tpl = document.getElementById("template-addOpinion");
      target.innerHTML = tpl ? tpl.innerHTML : "<p>Missing addOpinion template.</p>";

      if (typeof window.initOpinionForm === "function") {
        window.initOpinionForm();
      }
    }
  },
  {
    hash: "artInsert",
    target: "router-view",
    getTemplate: (targetElm, params) => {
      const offset = params && params.offset ? Number(params.offset) || 0 : 0;
      articleFormsHandler.showForm(targetElm, { mode: "insert", offset });
    }
  },
  {
    hash: "artEdit",
    target: "router-view",
    getTemplate: (targetElm, params) => {
      const id = params && params.id;
      const offset = params && params.offset ? Number(params.offset) || 0 : 0;
      articleFormsHandler.showForm(targetElm, { mode: "edit", id, offset });
    }
  },
  {
    hash: "artDelete",
    target: "router-view",
    getTemplate: (targetElm, params) => {
      articleFormsHandler.deleteArticleAndGoBack(targetElm, params || {});
    }
  }
];

// ===== Opinions rendering =====

function createHtml4opinions(targetElm) {
  const target = document.getElementById(targetElm);
  const tpl = document.getElementById("template-opinions");
  if (!target || !tpl) return;

  const raw = localStorage.getItem("opinions");
  let opinions = [];

  try {
    opinions = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Invalid opinions JSON", e);
    opinions = [];
  }

  // Compute stats
  let avgRating = 0;
  if (opinions.length > 0) {
    const sum = opinions.reduce((acc, o) => acc + (Number(o.ratingNumber) || 0), 0);
    avgRating = (sum / opinions.length).toFixed(1);
  }

  const viewData = {
    hasStats: opinions.length > 0,
    avgRating,
    count: opinions.length,
    opinions
  };

  const html = Mustache.render(tpl.innerHTML, viewData);
  target.innerHTML = html;
}

// ===== Articles from WT server (AJAX + pagination) =====


function fetchAndDisplayArticles(targetElm, params) {
  const target = document.getElementById(targetElm);
  const listTpl = document.getElementById("template-articles");
  const errorTpl = document.getElementById("template-articles-error");

  if (!target || !listTpl || !errorTpl) return;

  const pageSize = 10; // smaller page → fewer 504s
  const offset = params && params.offset ? Number(params.offset) || 0 : 0;
  const url = `${BASE_URL}/article?max=${pageSize}&offset=${offset}`;

  const onRetry = () => {
    // clear cooldown so retry actually retries
    localStorage.removeItem(API_COOLDOWN_KEY);
    fetchAndDisplayArticles(targetElm, params);
  };

  (async () => {
    setArticlesState(target, "loading");

    // If upstream is in cooldown, don't even try the API — use cache/fallback.
    const cooldownUntil = Number(localStorage.getItem(API_COOLDOWN_KEY) || "0");
    if (Date.now() < cooldownUntil) {
      // skip WT immediately, go fallback
      const fallbackText = await loadFallbackArticles(offset);
      setArticlesState(target, "error_cached");
      handleArticlesSuccess(fallbackText, listTpl, target, offset, pageSize);
      return;
    }

    // Try API up to 3 times (2 retries) with backoff.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { res, text } = await fetchTextWithTimeout(url, API_TIMEOUT_MS);

        if (!res.ok) {
          const err = new Error(`HTTP ${res.status}`);
          err.status = res.status;
          err.body = text;
          throw err;
        }

        handleArticlesSuccess(text, listTpl, target, offset, pageSize);
        clearCooldownOnSuccess();

        // cache last good response (per offset)
        try {
          localStorage.setItem(API_COOLDOWN_KEY, String(Date.now() + 2 * 60 * 1000)); // 2 minutes
        } catch (_) {}

        return;
      } catch (e) {
        // IMPORTANT: if AbortController cancelled it, it's a timeout on OUR side.
        // Either way, treat it as failure.
        setCooldownAfterFailure();

        if (location.hostname === "localhost") {
          console.error("Articles fetch failed:", e.name, e.message, e.status, e.body);
        }

        if (attempt < 2) await sleep(700 * (attempt + 1)); // backoff
      }
    }

    // fallback to cache
    try {
      const cached = localStorage.getItem(ARTICLES_CACHE_KEY + `:${offset}`);
      if (cached) {
        const { text } = JSON.parse(cached);
        setArticlesState(target, "error_cached");
        handleArticlesSuccess(text, listTpl, target, offset, pageSize);
        return;
      }
    } catch (_) {}

    // fallback to local JSON
    try {
      const text = await loadFallbackResponseText(pageSize, offset);
      setArticlesState(target, "error_cached");
      handleArticlesSuccess(text, listTpl, target, offset, pageSize);
      return;
    } catch (_) {}

    // try fallback JSON (site must not look dead)
    try {
      const fallbackText = await loadFallbackArticles(offset);
      setArticlesState(target, "error_cached"); // reuse the “API down” message
      handleArticlesSuccess(fallbackText, listTpl, target, offset, pageSize);
      return;
    } catch (e) {
      // final: render error
      target.innerHTML = Mustache.render(errorTpl.innerHTML, {});
      document.getElementById("retry-load-articles")?.addEventListener("click", onRetry);
    }
  })();
}


// ===== Article detail view (AJAX) =====

function fetchAndDisplayArticleDetail(targetElm, params) {
  const target = document.getElementById(targetElm);
  const tpl = document.getElementById("template-article-detail");
  if (!target || !tpl) return;

  const id = params && params.id;
  const backOffset = params && params.offset ? Number(params.offset) || 0 : 0;
  if (!id) {
    target.innerHTML = "<p>Chýba article ID.</p>";
    return;
  }

  const url = `${BASE_URL}/article/${encodeURIComponent(id)}`;
  const onRetry = () => fetchAndDisplayArticleDetail(targetElm, params);

  (async () => {
    target.innerHTML = "<p>Loading article…</p>";

    try {
      const { res, text } = await fetchTextWithTimeout(url, API_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = JSON.parse(text);

      const viewData = {
        id: data.id,
        title: data.title,
        author: data.author || "unknown",
        dateCreated: data.dateCreated ? data.dateCreated.substring(0, 10) : "",
        content: data.content || "",
        backOffset,
        comments: []
      };

      // load comments (best-effort)
      try {
        const commentsUrl = `${BASE_URL}/article/${encodeURIComponent(id)}/comment`;
        const { res: rc, text: tc } = await fetchTextWithTimeout(commentsUrl, API_TIMEOUT_MS);
        if (rc.ok) {
          viewData.comments = JSON.parse(tc) || [];
        }
      } catch (_) {
        viewData.comments = [];
      }

      target.innerHTML = Mustache.render(tpl.innerHTML, viewData);
      initCommentForm(id, backOffset);
    } catch (e) {
      target.innerHTML = `<p>Nepodarilo sa načítať článok.</p><button id="retry-article" type="button">Retry</button>`;
      document.getElementById("retry-article")?.addEventListener("click", onRetry);
      if (location.hostname === "localhost") console.error("Article detail fetch failed:", e);
    }
  })();
}

// ===== Comment form handling =====

function initCommentForm(articleId, backOffset) {
  const btn = document.getElementById("add-comment-btn");
  const container = document.getElementById("comment-form-container");
  if (!btn || !container) return;

  btn.addEventListener("click", () => {
    container.innerHTML = `
      <form id="comment-form">
        <div class="field">
          <label for="c-author">Meno *</label>
          <input id="c-author" name="author" required>
        </div>
        <div class="field">
          <label for="c-text">Komentár *</label>
          <textarea id="c-text" name="text" rows="3" required></textarea>
        </div>
        <button type="submit" class="btn primary">Odoslať komentár</button>
      </form>
    `;

    const form = document.getElementById("comment-form");
    const user = window.currentUser;
    if (user) {
      form.elements["author"].value = user.name;
    }

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const author = form.elements["author"].value.trim();
      const text = form.elements["text"].value.trim();
      if (!author || !text) {
        alert("Vyplňte meno aj text komentára.");
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE_URL}/article/${encodeURIComponent(articleId)}/comment`, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          window.location.hash = `#article?id=${articleId}&offset=${backOffset}`;
        } else {
          alert("Komentár sa nepodarilo uložiť.");
        }
      };
      xhr.onerror = () => alert("Chyba siete pri ukladaní komentára.");
      xhr.send(JSON.stringify({ author, text }));
    });
  });
}

// ===== Helpers =====

function handleArticlesSuccess(responseText, listTpl, target, offset, pageSize) {
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (e) {
    console.error("Invalid JSON from WT server", e);
    target.innerHTML = "<p>Chybná odpoveď servera.</p>";
    return;
  }

  const articles = Array.isArray(data.articles) ? data.articles : [];
  const meta = data.meta || {};
  const totalCount = typeof meta.totalCount === "number" ? meta.totalCount : 0;

  const hasPrev = offset > 0;
  const hasNext = offset + pageSize < totalCount;

  const viewData = {
    articles: articles.map(a => ({
      id: a.id,
      title: a.title,
      author: a.author || "unknown",
      dateCreated: a.dateCreated ? a.dateCreated.substring(0, 10) : "",
      contentShort: a.content ? a.content.substring(0, 160) + "..." : ""
    })),
    paging: {
      prev: hasPrev,
      next: hasNext,
      prevOffset: hasPrev ? Math.max(0, offset - pageSize) : null,
      nextOffset: hasNext ? offset + pageSize : null
    }
  };

  const html = Mustache.render(listTpl.innerHTML, viewData);
  target.innerHTML = html;
}