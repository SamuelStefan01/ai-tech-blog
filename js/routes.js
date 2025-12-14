import { ArticleFormsHandler } from "./articleFormsHandler.js";

const BASE_URL = "https://wt.kpi.fei.tuke.sk/api";
const articleFormsHandler = new ArticleFormsHandler(BASE_URL);
const API_COOLDOWN_KEY = "wt_api_cooldown_until";

function setCooldownAfterFailure() {
  // Prevent hammering a dead upstream; keep UI responsive by falling back quickly
  try { localStorage.setItem(API_COOLDOWN_KEY, String(Date.now() + 2 * 60 * 1000)); } catch (_) {}
}
function clearCooldownOnSuccess() {
  try { localStorage.removeItem(API_COOLDOWN_KEY); } catch (_) {}
}

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

// Optional backup source (e.g., GitHub raw JSON). If empty, backup step is skipped.
const BACKUP_JSON_URL = "https://cdn.jsdelivr.net/gh/samuelstefan01/ai-tech-blog@main/data/articles_fallback.json";

// Cache of full articles list (for offline detail view + client-side search/filter)
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

async function tryFetchJson(url) {
  const { res, text } = await fetchTextWithTimeout(url, API_TIMEOUT_MS);
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`);
    err.status = res.status;
    err.body = text;
    throw err;
  }
  return JSON.parse(text);
}

function shapePage(allArticles, pageSize, offset) {
  const total = Array.isArray(allArticles) ? allArticles.length : 0;
  const slice = (allArticles || []).slice(offset, offset + pageSize);
  return { articles: slice, meta: { totalCount: total, offset } };
}

async function loadArticlesWithFallback(pageSize, offset) {
  // Source order: cache -> WT page -> backup full -> local full
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
      if (res.ok) {
        const parsed = JSON.parse(text);
        // also refresh cache of the full list if this is the first page and meta.totalCount is reasonable
        // (WT doesn't offer "all" in one call reliably, so we cache just what we have if needed)
        return { data: parsed, source: "wt" };
      }
      throw new Error(`HTTP ${res.status}`);
    } catch (_) {
      setCooldownAfterFailure();
    }
  }

  // 3) Backup JSON (expects full list {articles:[...]} or array)
  if (BACKUP_JSON_URL) {
    try {
      const backup = await tryFetchJson(BACKUP_JSON_URL);
      const arr = Array.isArray(backup) ? backup : (backup.articles || []);
      if (Array.isArray(arr) && arr.length) {
        writeAllArticlesCache(arr);
        return { data: shapePage(arr, pageSize, offset), source: "backup" };
      }
    } catch (_) {}
  }

  // 4) Local fallback JSON (full list)
  const local = await tryFetchJson(FALLBACK_JSON_URL);
  const arr = Array.isArray(local) ? local : (local.articles || []);
  if (Array.isArray(arr) && arr.length) {
    writeAllArticlesCache(arr);
    return { data: shapePage(arr, pageSize, offset), source: "local" };
  }

  return { data: { articles: [], meta: { totalCount: 0, offset } }, source: "empty" };
}

function bannerForSource(source) {
  if (source === "wt") return null;
  if (source === "cache") return "WT server is unavailable — showing cached articles.";
  if (source === "backup") return "WT server is unavailable — showing articles from a backup source.";
  if (source === "local") return "WT server is unavailable — showing offline demo articles.";
  if (source === "empty") return "No articles available.";
  return null;
}

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

  const pageSize = 10;
  const offset = params && params.offset ? Number(params.offset) || 0 : 0;

  const onRetry = () => {
    localStorage.removeItem(API_COOLDOWN_KEY);
    fetchAndDisplayArticles(targetElm, params);
  };

  (async () => {
    setArticlesState(target, "loading");

    // GitHub Pages: WT is CORS-blocked. Skip WT entirely and fall back immediately.
    if (IS_GH_PAGES) {
      try {
        const cached = localStorage.getItem(ARTICLES_CACHE_KEY + `:${offset}`);
        if (cached) {
          const { text } = JSON.parse(cached);
          setArticlesState(target, "error_cached");
          handleArticlesSuccess(text, listTpl, target, offset, pageSize);
          return;
        }
      } catch (_) {}

      try {
        const text = await loadFallbackResponseText(pageSize, offset);
        setArticlesState(target, "error_cached");
        handleArticlesSuccess(text, listTpl, target, offset, pageSize);
        return;
      } catch (_) {
        target.innerHTML = Mustache.render(errorTpl.innerHTML, {});
        document.getElementById("retry-load-articles")?.addEventListener("click", onRetry);
        return;
      }
    }

    try {
      const { data, source } = await loadArticlesWithFallback(pageSize, offset);

      const banner = bannerForSource(source);
      if (banner) {
        // lightweight banner shown above the list
        target.innerHTML = `<div class="status-banner" role="status">${banner}</div>`;
      } else {
        target.innerHTML = "";
      }

      handleArticlesSuccess(JSON.stringify(data), listTpl, target, offset, pageSize);

      // if WT worked, clear cooldown
      if (source === "wt") clearCooldownOnSuccess();
    } catch (e) {
      // final: render error
      target.innerHTML = Mustache.render(errorTpl.innerHTML, {});
      document.getElementById("retry-load-articles")?.addEventListener("click", onRetry);
      if (location.hostname === "localhost") console.error("Articles render failed:", e);
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

  const onRetry = () => fetchAndDisplayArticleDetail(targetElm, params);

  (async () => {
    target.innerHTML = "<p>Loading article…</p>";

    // 1) Try WT detail first (if not in cooldown)
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
          dateCreated: data.dateCreated ? data.dateCreated.substring(0, 10) : "",
          content: data.content || "",
          backOffset,
          comments: []
        };

        // load comments (best-effort)
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

    // 2) Offline detail: search in cached/backup/local list
    try {
      let all = readAllArticlesCache();

      if (!all || !all.length) {
        // load local fallback list to satisfy detail view
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
        comments: []
      };

      // Offline comments (stored locally if WT is down)
      viewData.comments = loadLocalComments(id);

      target.innerHTML = Mustache.render(tpl.innerHTML, viewData);
      initCommentForm(id, backOffset);
    } catch (e) {
      // Offline fallback: try local seed
      try {
        const all = await (async () => { const r = await fetch(FALLBACK_JSON_URL, { cache: "no-store" }); if (!r.ok) throw 0; const j = await r.json(); return Array.isArray(j) ? j : (j.articles || []); })();
        const found = (all || []).find(a => String(a.id) === String(id));
        if (found) {
          const viewData = {
            id: found.id,
            title: found.title,
            author: found.author || "unknown",
            dateCreated: found.dateCreated ? String(found.dateCreated).substring(0,10) : "",
            content: found.content || "",
            backOffset,
            comments: loadLocalComments(id)
          };
          target.innerHTML = Mustache.render(tpl.innerHTML, viewData);
          initCommentForm(id, backOffset, true);
          return;
        }
      } catch (_) {}

      target.innerHTML = `<p>Nepodarilo sa načítať článok.</p><button id="retry-article" type="button">Retry</button>`;
      document.getElementById("retry-article")?.addEventListener("click", onRetry);
      if (location.hostname === "localhost") console.error("Offline article detail failed:", e);
    }
  })();
}


// ===== Comment form handling =====


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
function initCommentForm(articleId, backOffset, offlineOnly = false) {
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
      if (offlineOnly) {
        saveLocalComment(articleId, { author, text, dateCreated: new Date().toISOString(), local: true });
        window.location.hash = `#article?id=${articleId}&offset=${backOffset}`;
        return;
      }

      xhr.open("POST", `${BASE_URL}/article/${encodeURIComponent(articleId)}/comment`, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          window.location.hash = `#article?id=${articleId}&offset=${backOffset}`;
        } else {
          // WT server down: save comment locally so UX still works
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