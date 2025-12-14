import { ArticleFormsHandler } from "./articleFormsHandler.js";

// =====================
// Environment + endpoints
// =====================
const WT_BASE_URL = "https://wt.kpi.fei.tuke.sk/api";
const IS_NETLIFY = location.hostname.includes("netlify");          // covers netlify.app and many custom netlify domains
const IS_GH_PAGES = location.hostname.endsWith("github.io");

// On Netlify we call our proxy (/api/* -> /.netlify/functions/wtProxy/*).
// On GitHub Pages we DO NOT call WT at all (CORS will block), so we go straight to backup/local.
const BASE_URL = IS_NETLIFY ? "/api" : WT_BASE_URL;


// Base path that works on GitHub Pages subpaths even if <base href="/"> is present.
const APP_BASE = (() => {
  // e.g. "/ai-tech-blog/" on GH Pages, "/" on Netlify root
  const p = location.pathname;
  return p.endsWith("/") ? p : p.replace(/\/[^\/]*$/, "/");
})();

function absFromAppBase(relPath) {
  return location.origin + APP_BASE + relPath.replace(/^\//, "");
}
const articleFormsHandler = new ArticleFormsHandler(BASE_URL);

// =====================
// Reliability controls
// =====================
const API_COOLDOWN_KEY = "wt_api_cooldown_until";
const API_TIMEOUT_MS = 3500; // keep it short so UI doesn't hang

function setCooldownAfterFailure(ms = 2 * 60 * 1000) { // 2 minutes
  try { localStorage.setItem(API_COOLDOWN_KEY, String(Date.now() + ms)); } catch (_) {}
}
function clearCooldownOnSuccess() {
  try { localStorage.removeItem(API_COOLDOWN_KEY); } catch (_) {}
}

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

// =====================
// Fallback sources (always available)
// =====================
const FALLBACK_JSON_URL = absFromAppBase("data/articles_fallback.json");
const BACKUP_SOURCES = [
  "https://cdn.jsdelivr.net/gh/samuelstefan01/ai-tech-blog@main/data/articles_fallback.json?v=20251214",
  "https://raw.githubusercontent.com/samuelstefan01/ai-tech-blog/main/data/articles_fallback.json?v=20251214"
];

// Cache LAST GOOD PAGE response (per offset) so refresh works even offline
const ARTICLES_CACHE_KEY = "articles_cache_v2";

function setArticlesState(target, state, extra = {}) {
  if (!target) return;

  if (state === "loading") {
    target.innerHTML = "<section id=\"articles\"><h2>Články</h2><p>Loading articles…</p></section>";
    return;
  }

  if (state === "offline_banner") {
    target.innerHTML =
      "<section id=\"articles\"><h2>Články</h2><p>Server je nedostupný — zobrazujem offline/backup články.</p></section>";
    return;
  }

  if (state === "error") {
    target.innerHTML =
      "<section id=\"articles\"><h2>Články</h2><p>Nepodarilo sa načítať články.</p><button id=\"retry-load-articles\" type=\"button\">Retry</button></section>";
    const btn = document.getElementById("retry-load-articles");
    if (btn) btn.addEventListener("click", () => extra.onRetry && extra.onRetry());
  }
}


async function fetchJsonWithTimeout(url, ms = 3500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { cache: "no-store", signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

async function fetchFallbackObject() {
  // IMPORTANT:
  // - Prefer SAME-ORIGIN fallback first (GH Pages / static hosting).
  // - Only use CDN/raw backups if the local file is missing/unreachable.
  try {
    return await fetchJsonWithTimeout(FALLBACK_JSON_URL, 3500);
  } catch (_) {
    // continue to backups
  }

  for (const url of BACKUP_SOURCES) {
    try {
      return await fetchJsonWithTimeout(url, 3500);
    } catch (_) {}
  }

  throw new Error("No fallback source available");
}

async function loadFallbackResponseText(pageSize, offset) {
  const all = await fetchFallbackObject();
  const arr = Array.isArray(all) ? all : (all.articles || []);
  const total = Array.isArray(arr) ? arr.length : 0;
  const slice = (arr || []).slice(offset, offset + pageSize);
  const shaped = {  __source: "fallback", articles: slice, meta: { totalCount: total, offset }};
  return JSON.stringify(shaped);
}

// =====================
// Routes config for SPA
// =====================
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
      if (typeof window.initOpinionForm === "function") window.initOpinionForm();
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
  try { opinions = raw ? JSON.parse(raw) : []; } catch (_) { opinions = []; }

  let avgRating = 0;
  if (opinions.length > 0) {
    const sum = opinions.reduce((acc, o) => acc + (Number(o.ratingNumber) || 0), 0);
    avgRating = (sum / opinions.length).toFixed(1);
  }

  const viewData = { hasStats: opinions.length > 0, avgRating, count: opinions.length, opinions };
  target.innerHTML = Mustache.render(tpl.innerHTML, viewData);
}

// =====================
// Articles list (AJAX + pagination) with REAL fallback
// =====================
function fetchAndDisplayArticles(targetElm, params) {
  const target = document.getElementById(targetElm);
  const listTpl = document.getElementById("template-articles");
  const errorTpl = document.getElementById("template-articles-error");

  if (!target || !listTpl || !errorTpl) return;

  const pageSize = 4;
  const offset = params && params.offset ? Number(params.offset) || 0 : 0;

  const onRetry = () => {
    try { localStorage.removeItem(API_COOLDOWN_KEY); } catch (_) {}
    fetchAndDisplayArticles(targetElm, params);
  };

  (async () => {
    setArticlesState(target, "loading");

    // GitHub Pages: skip WT completely (CORS) and go straight to fallback.
    if (IS_GH_PAGES) {
      const text = await loadFallbackResponseText(pageSize, offset);
      setArticlesState(target, "offline_banner");
      handleArticlesSuccess(text, listTpl, target, offset, pageSize);
      return;
    }

    // Netlify/others: try API unless in cooldown
    const cooldownUntil = Number(localStorage.getItem(API_COOLDOWN_KEY) || "0");
    const canTryApi = Date.now() >= cooldownUntil;

    if (canTryApi) {
      const url = `${BASE_URL}/article?max=${pageSize}&offset=${offset}`;

      // Try once + one retry (fast)
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { res, text } = await fetchTextWithTimeout(url, API_TIMEOUT_MS);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          // Reject proxy error JSON (no articles)
          const parsed = JSON.parse(text);
          if (!parsed || !Array.isArray(parsed.articles)) throw new Error("Non-article JSON");

          // Cache this page response
          try {
            localStorage.setItem(`${ARTICLES_CACHE_KEY}:${offset}`, JSON.stringify({ text, t: Date.now() }));
          } catch (_) {}

          clearCooldownOnSuccess();
          handleArticlesSuccess(text, listTpl, target, offset, pageSize);
          return;
        } catch (e) {
          setCooldownAfterFailure();
          if (attempt === 0) await sleep(250);
        }
      }
    }

    // If API failed or was in cooldown: use cached page if available
    try {
      const cached = localStorage.getItem(`${ARTICLES_CACHE_KEY}:${offset}`);
      if (cached) {
        const { text } = JSON.parse(cached);
        setArticlesState(target, "offline_banner");
        handleArticlesSuccess(text, listTpl, target, offset, pageSize);
        return;
      }
    } catch (_) {}

    // Finally: use backup/local seed
    try {
      const text = await loadFallbackResponseText(pageSize, offset);
      setArticlesState(target, "offline_banner");
      handleArticlesSuccess(text, listTpl, target, offset, pageSize);
      return;
    } catch (_) {}

    // Last: show error template
    target.innerHTML = Mustache.render(errorTpl.innerHTML, {});
    document.getElementById("retry-load-articles")?.addEventListener("click", onRetry);
  })().catch(() => {
    // If anything unexpected happens, don't hang on "Loading..."
    setArticlesState(target, "error", { onRetry });
  });
}

// ===== Article detail view (AJAX) =====
function fetchAndDisplayArticleDetail(targetElm, params) {
  const target = document.getElementById(targetElm);
  const tpl = document.getElementById("template-article-detail");
  if (!target || !tpl) return;

  const id = params && params.id;
  const backOffset = params && params.offset ? Number(params.offset) || 0 : 0;
  if (!id) { target.innerHTML = "<p>Chýba article ID.</p>"; return; }

  // GH Pages: serve detail from fallback store (no WT)
  if (IS_GH_PAGES) {
    (async () => {
      const all = await fetchFallbackObject();
      const arr = Array.isArray(all) ? all : (all.articles || []);
      const found = (arr || []).find(a => String(a.id) === String(id));
      if (!found) { target.innerHTML = "<p>Článok neexistuje (offline).</p>"; return; }
      const viewData = {
        id: found.id,
        title: found.title,
        author: found.author || "unknown",
        dateCreated: (found.dateCreated || "").toString().substring(0, 10),
        content: found.content || "",
        backOffset,
        comments: []
      };
      target.innerHTML = Mustache.render(tpl.innerHTML, viewData);
    })();
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
        dateCreated: data.dateCreated ? String(data.dateCreated).substring(0, 10) : "",
        content: data.content || "",
        backOffset,
        comments: []
      };

      // load comments (best-effort)
      try {
        const commentsUrl = `${BASE_URL}/article/${encodeURIComponent(id)}/comment`;
        const { res: rc, text: tc } = await fetchTextWithTimeout(commentsUrl, API_TIMEOUT_MS);
        if (rc.ok) viewData.comments = JSON.parse(tc) || [];
      } catch (_) {}

      target.innerHTML = Mustache.render(tpl.innerHTML, viewData);
      initCommentForm(id, backOffset);
    } catch (e) {
      // fallback to local seed
      try {
        const all = await fetchFallbackObject();
        const arr = Array.isArray(all) ? all : (all.articles || []);
        const found = (arr || []).find(a => String(a.id) === String(id));
        if (!found) throw e;

        const viewData = {
          id: found.id,
          title: found.title,
          author: found.author || "unknown",
          dateCreated: (found.dateCreated || "").toString().substring(0, 10),
          content: found.content || "",
          backOffset,
          comments: []
        };
        target.innerHTML = Mustache.render(tpl.innerHTML, viewData);
        return;
      } catch (_) {}

      target.innerHTML = `<p>Nepodarilo sa načítať článok.</p><button id="retry-article" type="button">Retry</button>`;
      document.getElementById("retry-article")?.addEventListener("click", onRetry);
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
    if (user) form.elements["author"].value = user.name;

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const author = form.elements["author"].value.trim();
      const text = form.elements["text"].value.trim();
      if (!author || !text) { alert("Vyplňte meno aj text komentára."); return; }

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

// ===== Render helper =====
function handleArticlesSuccess(responseText, listTpl, target, offset, pageSize) {
  let data;
  try { data = JSON.parse(responseText); } catch (_) { target.innerHTML = "<p>Chybná odpoveď servera.</p>"; return; }

  const articles = Array.isArray(data.articles) ? data.articles : [];
  const meta = data.meta || {};
  const totalCount = typeof meta.totalCount === "number" ? meta.totalCount : articles.length;

  const hasPrev = offset > 0;
  const hasNext = offset + pageSize < totalCount;

  const viewData = {
    title: data.__source === "fallback"
      ? "Offline články z lokálnej knižnice"
      : "Články z WT servera",

    articles: articles.map(a => ({
      id: a.id,
      title: a.title,
      author: a.author || "unknown",
      dateCreated: a.dateCreated ? String(a.dateCreated).substring(0, 10) : "",
      contentShort: a.content
        ? String(a.content).replace(/<[^>]*>/g, "").substring(0, 160) + "..."
        : ""
    })),

    paging: {
      prev: hasPrev,
      next: hasNext,
      prevOffset,
      nextOffset
    }
  };

  setTimeout(() => {
  const input = document.getElementById("article-search");
  if (!input) return;

  input.addEventListener("input", (e) => {
    const q = e.target.value.toLowerCase().trim();

    const filtered = articles.filter(a => {
      return (
        (a.title || "").toLowerCase().includes(q) ||
        (a.author || "").toLowerCase().includes(q) ||
        (a.content || "").toLowerCase().includes(q)
      );
    });

    const filteredView = {
      ...viewData,
      articles: filtered.map(a => ({
        id: a.id,
        title: a.title,
        author: a.author || "unknown",
        dateCreated: a.dateCreated
          ? String(a.dateCreated).substring(0, 10)
          : "",
        contentShort: a.content
          ? String(a.content).replace(/<[^>]*>/g, "").substring(0, 160) + "..."
          : ""
      })),
      paging: null // hide pagination during search
    };

    target.innerHTML = Mustache.render(listTpl.innerHTML, filteredView);
  });
}, 0);

  target.innerHTML = Mustache.render(listTpl.innerHTML, viewData);
}