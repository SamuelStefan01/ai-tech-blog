import { ArticleFormsHandler } from "./articleFormsHandler.js";

const BASE_URL = "https://wt.kpi.fei.tuke.sk/api";
const articleFormsHandler = new ArticleFormsHandler(BASE_URL);

// ===== WT cooldown (avoid hammering dead upstream) =====
const API_COOLDOWN_KEY = "wt_api_cooldown_until";

function setCooldownAfterFailure() {
  try { localStorage.setItem(API_COOLDOWN_KEY, String(Date.now() + 2 * 60 * 1000)); } catch (_) {}
}
function clearCooldownOnSuccess() {
  try { localStorage.removeItem(API_COOLDOWN_KEY); } catch (_) {}
}

// ===== Resilient fetch helpers (timeout + cache + fallbacks) =====
const API_TIMEOUT_MS = 65000; // 65s client timeout

// Local fallback bundled with the site
const FALLBACK_JSON_URL = "./data/articles_fallback.json";

// Backup sources (CDN first, raw as a second option)
const BACKUP_SOURCES = [
  "https://cdn.jsdelivr.net/gh/samuelstefan01/ai-tech-blog@main/data/articles_fallback.json",
  "https://raw.githubusercontent.com/samuelstefan01/ai-tech-blog/main/data/articles_fallback.json"
].filter(Boolean);

// Cache of full articles list (for offline list + offline detail)
const ARTICLES_ALL_CACHE_KEY = "articles_all_cache_v1";
const ARTICLES_ALL_CACHE_TIME_KEY = "articles_all_cache_time_v1";
const ARTICLES_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

function readAllArticlesCache() {
  try {
    const t = Number(localStorage.getItem(ARTICLES_ALL_CACHE_TIME_KEY) || "0");
    if (!t || (Date.now() - t) > ARTICLES_CACHE_TTL_MS) return null;
    const raw = localStorage.getItem(ARTICLES_ALL_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
}

function writeAllArticlesCache(articlesArray) {
  try {
    localStorage.setItem(ARTICLES_ALL_CACHE_KEY, JSON.stringify(articlesArray));
    localStorage.setItem(ARTICLES_ALL_CACHE_TIME_KEY, String(Date.now()));
  } catch (_) {}
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

async function tryFetchJson(url) {
  const { res, text } = await fetchTextWithTimeout(url, API_TIMEOUT_MS);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return JSON.parse(text);
}

function shapePage(allArticles, pageSize, offset) {
  const total = Array.isArray(allArticles) ? allArticles.length : 0;
  const slice = (allArticles || []).slice(offset, offset + pageSize);
  return { articles: slice, meta: { totalCount: total, offset } };
}

function bannerForSource(source) {
  if (source === "wt") return null;
  if (source === "cache") return "WT server is unavailable — showing cached articles.";
  if (source === "backup") return "WT server is unavailable — showing articles from a backup source.";
  if (source === "local") return "WT server is unavailable — showing offline demo articles.";
  if (source === "empty") return "No articles available.";
  return null;
}

/**
 * Provider chain:
 *  1) full-list cache (localStorage)
 *  2) WT paged endpoint
 *  3) backup JSON sources (CDN/raw)
 *  4) local bundled JSON file
 */
async function loadArticlesWithFallback(pageSize, offset) {
  // 1) Cached full list
  const cachedAll = readAllArticlesCache();
  if (cachedAll && cachedAll.length) {
    return { data: shapePage(cachedAll, pageSize, offset), source: "cache" };
  }

  // 2) WT page (if not in cooldown)
  const cooldownUntil = Number(localStorage.getItem(API_COOLDOWN_KEY) || "0");
  if (Date.now() >= cooldownUntil) {
    try {
      const url = `${BASE_URL}/article?max=${pageSize}&offset=${offset}`;
      const { res, text } = await fetchTextWithTimeout(url, API_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const parsed = JSON.parse(text);
      clearCooldownOnSuccess();
      // Note: WT is paged; we don't try to cache "all" here.
      return { data: parsed, source: "wt" };
    } catch (_) {
      setCooldownAfterFailure();
    }
  }

  // 3) Backup JSON (expects either array OR {articles:[...]} )
  for (const url of BACKUP_SOURCES) {
    try {
      const backup = await tryFetchJson(url);
      const arr = Array.isArray(backup) ? backup : (backup.articles || []);
      if (Array.isArray(arr) && arr.length) {
        writeAllArticlesCache(arr);
        return { data: shapePage(arr, pageSize, offset), source: "backup" };
      }
    } catch (_) {}
  }

  // 4) Local fallback JSON
  const local = await tryFetchJson(FALLBACK_JSON_URL);
  const arr = Array.isArray(local) ? local : (local.articles || []);
  if (Array.isArray(arr) && arr.length) {
    writeAllArticlesCache(arr);
    return { data: shapePage(arr, pageSize, offset), source: "local" };
  }

  return { data: { articles: [], meta: { totalCount: 0, offset } }, source: "empty" };
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

  try {
    opinions = raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Invalid opinions JSON", e);
    opinions = [];
  }

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

  target.innerHTML = Mustache.render(tpl.innerHTML, viewData);
}

// ===== Articles list (AJAX + pagination) =====
function fetchAndDisplayArticles(targetElm, params) {
  const target = document.getElementById(targetElm);
  const listTpl = document.getElementById("template-articles");
  const errorTpl = document.getElementById("template-articles-error");

  if (!target || !listTpl || !errorTpl) return;

  const pageSize = 10;
  const offset = params && params.offset ? Number(params.offset) || 0 : 0;

  const onRetry = () => {
    try { localStorage.removeItem(API_COOLDOWN_KEY); } catch (_) {}
    fetchAndDisplayArticles(targetElm, params);
  };

  (async () => {
    target.innerHTML = "<section id=\"articles\"><h2>Články</h2><p>Loading articles…</p></section>";

    try {
      const { data, source } = await loadArticlesWithFallback(pageSize, offset);

      const banner = bannerForSource(source);
      const bannerHtml = banner ? `<div class="status-banner" role="status">${banner}</div>` : "";

      // Render list
      const listHtml = renderArticlesListHTML(data, listTpl, offset, pageSize);
      target.innerHTML = bannerHtml + listHtml;
    } catch (e) {
      target.innerHTML = Mustache.render(errorTpl.innerHTML, {});
      document.getElementById("retry-load-articles")?.addEventListener("click", onRetry);
      if (location.hostname === "localhost") console.error("Articles render failed:", e);
    }
  })();
}

function renderArticlesListHTML(data, listTpl, offset, pageSize) {
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
      dateCreated: a.dateCreated ? String(a.dateCreated).substring(0, 10) : "",
      contentShort: a.content ? String(a.content).replace(/<[^>]*>/g, "").substring(0, 160) + "..." : ""
    })),
    paging: {
      prev: hasPrev,
      next: hasNext,
      prevOffset: hasPrev ? Math.max(0, offset - pageSize) : null,
      nextOffset: hasNext ? offset + pageSize : null
    }
  };

  return Mustache.render(listTpl.innerHTML, viewData);
}

// ===== Article detail view (AJAX + offline fallback) =====
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

  const onRetry = () => fetchAndDisplayArticleDetail(targetElm, params);

  (async () => {
    target.innerHTML = "<p>Loading article…</p>";

    // 1) Try WT detail (if not in cooldown)
    const cooldownUntil = Number(localStorage.getItem(API_COOLDOWN_KEY) || "0");
    if (Date.now() >= cooldownUntil) {
      try {
        const url = `${BASE_URL}/article/${encodeURIComponent(id)}`;
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

        // comments best-effort
        try {
          const commentsUrl = `${BASE_URL}/article/${encodeURIComponent(id)}/comment`;
          const { res: rc, text: tc } = await fetchTextWithTimeout(commentsUrl, API_TIMEOUT_MS);
          if (rc.ok) viewData.comments = JSON.parse(tc) || [];
        } catch (_) {
          viewData.comments = [];
        }

        target.innerHTML = Mustache.render(tpl.innerHTML, viewData);
        initCommentForm(id, backOffset);
        clearCooldownOnSuccess();
        return;
      } catch (e) {
        setCooldownAfterFailure();
        if (location.hostname === "localhost") console.error("WT article detail failed:", e);
      }
    }

    // 2) Offline detail: cached list or local file
    try {
      let all = readAllArticlesCache();
      if (!all || !all.length) {
        const local = await tryFetchJson(FALLBACK_JSON_URL);
        all = Array.isArray(local) ? local : (local.articles || []);
        if (Array.isArray(all) && all.length) writeAllArticlesCache(all);
      }

      const found = (all || []).find(a => String(a.id) === String(id));
      if (!found) throw new Error("Article not found in offline store");

      const viewData = {
        id: found.id,
        title: found.title,
        author: found.author || "unknown",
        dateCreated: found.dateCreated ? String(found.dateCreated).substring(0, 10) : "",
        content: found.content || "",
        backOffset,
        comments: loadLocalComments(id)
      };

      target.innerHTML = Mustache.render(tpl.innerHTML, viewData);
      initCommentForm(id, backOffset);
    } catch (e) {
      target.innerHTML = `<p>Nepodarilo sa načítať článok.</p><button id="retry-article" type="button">Retry</button>`;
      document.getElementById("retry-article")?.addEventListener("click", onRetry);
      if (location.hostname === "localhost") console.error("Offline article detail failed:", e);
    }
  })();
}

// ===== Local comment storage (offline-safe) =====
const LOCAL_COMMENTS_KEY = "local_comments_v1";

function loadLocalComments(articleId) {
  try {
    const raw = localStorage.getItem(LOCAL_COMMENTS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    const arr = obj && obj[articleId] ? obj[articleId] : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

function saveLocalComment(articleId, comment) {
  try {
    const raw = localStorage.getItem(LOCAL_COMMENTS_KEY);
    const obj = raw ? JSON.parse(raw) : {};
    const arr = Array.isArray(obj[articleId]) ? obj[articleId] : [];
    arr.unshift(comment);
    obj[articleId] = arr;
    localStorage.setItem(LOCAL_COMMENTS_KEY, JSON.stringify(obj));
  } catch (_) {}
}

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
          saveLocalComment(articleId, { author, text, dateCreated: new Date().toISOString(), local: true, likes: 0 });
          window.location.hash = `#article?id=${articleId}&offset=${backOffset}`;
        }
      };

      xhr.onerror = () => {
        saveLocalComment(articleId, { author, text, dateCreated: new Date().toISOString(), local: true, likes: 0 });
        window.location.hash = `#article?id=${articleId}&offset=${backOffset}`;
      };

      xhr.send(JSON.stringify({ author, text }));
    });
  });
}
