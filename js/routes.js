import { ArticleFormsHandler } from "./articleFormsHandler.js";

// =====================
// Environment + endpoints
// =====================
const WT_BASE_URL = "https://wt.kpi.fei.tuke.sk/api";
const IS_NETLIFY = location.hostname.includes("netlify");          // covers netlify.app and many custom netlify domains
const IS_GH_PAGES = location.hostname.endsWith("github.io");

// On Netlify we call our proxy (/api/* -> /.netlify/functions/wtProxy/*).
// On GitHub Pages / localhost we try WT first; if it fails (CORS/down), we fall back to local/backup.
const BASE_URL = IS_NETLIFY ? "/api" : WT_BASE_URL;

// =====================
// AWT11 supplementary: show only "our" articles
// =====================
// Pick a tag that is unique to your project. This tag is NOT shown in UI/forms.
const MY_TAG = "boss_ai_tech_2025";


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

// Simple Promise-based XHR (required by AWT11 task 4)
function xhrGetJson(url, timeoutMs = API_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("GET", url, true);
    xhr.timeout = timeoutMs;
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (e) { reject(new Error("Invalid JSON")); }
      } else {
        reject(new Error(`HTTP ${xhr.status}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.ontimeout = () => reject(new Error("Timeout"));
    xhr.send();
  });
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

// Local-only articles (UX fallback for testing when WT server blocks CORS on 127.0.0.1)
const LOCAL_ARTICLES_KEY = "local_articles_v1";
function getLocalArticles() {
  try {
    const arr = JSON.parse(localStorage.getItem(LOCAL_ARTICLES_KEY) || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch (_) {
    return [];
  }
}

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
  const shaped = { __source: "fallback", articles: slice, meta: { totalCount: total, offset } };
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

    // Netlify/others: try API unless in cooldown
    const cooldownUntil = Number(localStorage.getItem(API_COOLDOWN_KEY) || "0");
    const canTryApi = Date.now() >= cooldownUntil;

    if (canTryApi) {
      // Show only our articles (AWT11 supplementary #2: tag filter)
      const url = `${BASE_URL}/article?tag=${encodeURIComponent(MY_TAG)}&max=${pageSize}&offset=${offset}`;

      // Try once + one retry (fast)
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const { res, text } = await fetchTextWithTimeout(url, API_TIMEOUT_MS);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);

          // Reject proxy error JSON (no articles)
          const parsed = JSON.parse(text);
          if (!parsed || !Array.isArray(parsed.articles)) throw new Error("Non-article JSON");

          // AWT11 task 4: list response may miss article bodies (content).
          // Enrich each article using AJAX XMLHttpRequest (detail endpoint).
          const enrichedArticles = await Promise.all(parsed.articles.map(async (a) => {
            // If content is already present, keep it.
            if (a && typeof a.content === "string" && a.content.trim()) return a;
            try {
              const detail = await xhrGetJson(`${BASE_URL}/article/${encodeURIComponent(a.id)}`);
              return { ...a, content: detail.content || "" };
            } catch (_) {
              return { ...a, content: "" };
            }
          }));
          parsed.articles = enrichedArticles;
          const enrichedText = JSON.stringify(parsed);

          // Cache this page response
          try {
            localStorage.setItem(`${ARTICLES_CACHE_KEY}:${offset}`, JSON.stringify({ text: enrichedText, t: Date.now() }));
          } catch (_) {}

          clearCooldownOnSuccess();
          handleArticlesSuccess(enrichedText, listTpl, target, offset, pageSize);
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
  const cOffset = params && params.cOffset ? Number(params.cOffset) || 0 : 0;
  const commentsPageSize = 10;

  // Local comment storage helpers (for local-* articles)
  const getLocalComments = (articleId) => {
    try {
      return JSON.parse(localStorage.getItem(`local_comments_v1_${articleId}`) || "[]") || [];
    } catch (_) {
      return [];
    }
  };

  // Local-only article support (UX fallback for testing when WT server is blocked).
  if (typeof id === "string" && id.startsWith("local-")) {
    const locals = getLocalArticles();
    const found = locals.find(a => String(a.id) === String(id));
    if (found) {
      const allComments = getLocalComments(found.id);
      const pageComments = allComments.slice(cOffset, cOffset + commentsPageSize);
      const hasPrev = cOffset > 0;
      const hasNext = cOffset + commentsPageSize < allComments.length;
      const viewData = {
        id: found.id,
        title: found.title,
        author: found.author || "unknown",
        dateCreated: (found.dateCreated || "").toString().substring(0, 10),
        content: found.content || "",
        backOffset,
        comments: pageComments,
        commentPaging: (hasPrev || hasNext) ? {
          prev: hasPrev,
          next: hasNext,
          prevOffset: Math.max(0, cOffset - commentsPageSize),
          nextOffset: cOffset + commentsPageSize,
          cOffset
        } : null
      };
      target.innerHTML = Mustache.render(tpl.innerHTML, viewData);
      initCommentForm(found.id, backOffset);
      return;
    }
  }
  if (!id) { target.innerHTML = "<p>Chýba article ID.</p>"; return; }

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
        comments: [],
        commentPaging: null
      };

      // load comments (best-effort)
      try {
        const commentsUrl = `${BASE_URL}/article/${encodeURIComponent(id)}/comment?max=${commentsPageSize}&offset=${cOffset}`;
        const cData = await xhrGetJson(commentsUrl, API_TIMEOUT_MS);

        // WT API sometimes returns an array, sometimes an object with {comments, meta}
        const commentsArr = Array.isArray(cData) ? cData : (cData.comments || []);
        viewData.comments = (commentsArr || []).slice(0, commentsPageSize);

        // Paging: best-effort (if meta missing, allow Next when we got a full page)
        const total = (!Array.isArray(cData) && cData.meta && typeof cData.meta.totalCount === "number")
          ? cData.meta.totalCount
          : null;
        const hasPrev = cOffset > 0;
        const hasNext = total != null ? (cOffset + commentsPageSize < total) : (commentsArr.length === commentsPageSize);
        if (hasPrev || hasNext) {
          viewData.commentPaging = {
            prev: hasPrev,
            next: hasNext,
            prevOffset: Math.max(0, cOffset - commentsPageSize),
            nextOffset: cOffset + commentsPageSize,
            cOffset
          };
        }
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
        // Even in offline fallback mode we still want the Add Comment UX to work.
        // (Posting to server may fail, but the form must appear.)
        initCommentForm(found.id, backOffset);
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

  // Persist context so delegated handlers (and debugging) always know
  // which article we are working with.
  btn.dataset.articleId = String(articleId);
  btn.dataset.backOffset = String(backOffset ?? 0);

  // IMPORTANT FIX:
  // This route is re-rendered often; if we keep stacking listeners, weird things happen.
  // Using direct assignment guarantees exactly one handler per render.
  btn.onclick = () => {
    // simple toggle: if form already visible, collapse it
    if (container.querySelector("#comment-form")) {
      container.innerHTML = "";
      return;
    }

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
    if (!form) {
      alert("Nepodarilo sa zobraziť formulár pre komentár.");
      return;
    }
    const user = window.currentUser;
    if (user) form.elements["author"].value = user.name;

    // UX: focus first empty field
    if (!form.elements["author"].value) form.elements["author"].focus();
    else form.elements["text"].focus();

    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const author = form.elements["author"].value.trim();
      const text = form.elements["text"].value.trim();
      if (!author || !text) { alert("Vyplňte meno aj text komentára."); return; }

      // Local-only articles: store comments locally so Add Comment works even when WT server is blocked.
      if (String(articleId).startsWith("local-")) {
        try {
          const key = `local_comments_v1_${articleId}`;
          const current = JSON.parse(localStorage.getItem(key) || "[]") || [];
          current.unshift({ author, text, dateCreated: new Date().toISOString() });
          localStorage.setItem(key, JSON.stringify(current));
          window.location.hash = `#article?id=${articleId}&offset=${backOffset}&cOffset=0`;
          return;
        } catch (_) {
          alert("Nepodarilo sa uložiť lokálny komentár.");
          return;
        }
      }

      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${BASE_URL}/article/${encodeURIComponent(articleId)}/comment`, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          window.location.hash = `#article?id=${articleId}&offset=${backOffset}&cOffset=0`;
        } else {
          alert("Komentár sa nepodarilo uložiť.");
        }
      };
      xhr.onerror = () => alert("Chyba siete pri ukladaní komentára.");
      xhr.send(JSON.stringify({ author, text }));
    });
  };
}

// ===== Render helper =====
function handleArticlesSuccess(responseText, listTpl, target, offset, pageSize) {
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (_) {
    target.innerHTML = "<p>Chybná odpoveď servera.</p>";
    return;
  }

  let allArticles = Array.isArray(data.articles) ? data.articles : [];
  // UX fallback: if user saved something locally (because server was blocked),
  // show those items at the top so Add Article can be tested end-to-end.
  const locals = getLocalArticles();
  if (locals.length) {
    const localIds = new Set(locals.map(a => String(a.id)));
    const withoutDup = allArticles.filter(a => !localIds.has(String(a.id)));
    allArticles = [...locals, ...withoutDup];
  }
  const meta = data.meta || {};
  const totalCount = typeof meta.totalCount === "number" ? meta.totalCount : allArticles.length;

  const hasPrev = offset > 0;
  const hasNext = offset + pageSize < totalCount;
  const prevOffset = hasPrev ? Math.max(0, offset - pageSize) : null;
  const nextOffset = hasNext ? offset + pageSize : null;

  const title =
    data.__source === "fallback"
      ? "Offline články z lokálnej knižnice"
      : "Články z WT servera";

  function mapArticles(arr) {
    return (arr || []).map(a => ({
      id: a.id,
      title: a.title,
      author: a.author || "unknown",
      dateCreated: a.dateCreated ? String(a.dateCreated).substring(0, 10) : "",
      contentShort: a.content
        ? String(a.content)
            .replace(/<[^>]*>/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .substring(0, 160) + "..."
        : ""
    }));
  }

  function render(query, caretPos) {
    const q = (query || "").toLowerCase().trim();

    const filtered = !q
      ? allArticles
      : allArticles.filter(a =>
          (a.title || "").toLowerCase().includes(q) ||
          (a.author || "").toLowerCase().includes(q) ||
          (a.content || "").toLowerCase().includes(q)
        );

    const viewData = {
      title,
      listOffset: offset,
      articles: mapArticles(filtered),
      paging: q ? null : ((hasPrev || hasNext) ? {
        prev: hasPrev,
        next: hasNext,
        prevOffset,
        nextOffset
      } : null)
    };

    target.innerHTML = Mustache.render(listTpl.innerHTML, viewData);

    const input = document.getElementById("article-search");
    if (!input) return;

    input.value = query || "";

    // Restore focus + caret so user can type continuously.
    input.focus();
    const pos = (typeof caretPos === "number") ? caretPos : input.value.length;
    try { input.setSelectionRange(pos, pos); } catch (_) {}

    input.oninput = (e) => {
      const v = e.target.value;
      const c = (typeof e.target.selectionStart === "number") ? e.target.selectionStart : v.length;
      render(v, c);
    };

    input.onkeydown = (e) => {
      if (e.key === "Escape") {
        input.value = "";
        render("", 0);
      }
    };
  }

  render("", 0);
}

// =====================
// Robust delegated UX handlers
// (prevents "button does nothing" if a re-render ever skips binding)
// =====================
document.addEventListener("click", (e) => {
  const btn = e.target.closest ? e.target.closest("#add-comment-btn") : null;
  if (!btn) return;

  // If initCommentForm already bound btn.onclick, let it handle the click.
  if (typeof btn.onclick === "function") return;

  const container = document.getElementById("comment-form-container");
  if (!container) return;

  // Pull context from data-* OR fall back to the current route params.
  const parseHashParam = (k) => {
    try {
      const h = window.location.hash || "";
      const q = h.includes("?") ? h.split("?").slice(1).join("?") : "";
      const sp = new URLSearchParams(q);
      return sp.get(k);
    } catch (_) {
      return null;
    }
  };

  const articleId = btn.dataset.articleId || parseHashParam("id");
  const backOffset = btn.dataset.backOffset || parseHashParam("offset") || "0";
  if (!articleId) {
    alert("Chýba ID článku pre pridanie komentára.");
    return;
  }

  // Fallback: render the same form as initCommentForm.
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
  if (user && form) form.elements["author"].value = user.name;
  form?.elements["text"]?.focus();

  form?.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const author = form.elements["author"].value.trim();
    const text = form.elements["text"].value.trim();
    if (!author || !text) {
      alert("Vyplňte meno aj text komentára.");
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Odosielam...";
    }

    // Local-only comments
    if (String(articleId).startsWith("local-")) {
      try {
        const key = `local_comments_v1_${articleId}`;
        const current = JSON.parse(localStorage.getItem(key) || "[]") || [];
        current.unshift({ author, text, dateCreated: new Date().toISOString() });
        localStorage.setItem(key, JSON.stringify(current));
        window.location.hash = `#article?id=${articleId}&offset=${backOffset}&cOffset=0`;
        return;
      } catch (_) {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Odoslať komentár"; }
        alert("Nepodarilo sa uložiť lokálny komentár.");
        return;
      }
    }

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${BASE_URL}/article/${encodeURIComponent(articleId)}/comment`, true);
    xhr.setRequestHeader("Content-Type", "application/json");
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        window.location.hash = `#article?id=${articleId}&offset=${backOffset}&cOffset=0`;
      } else {
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Odoslať komentár"; }
        alert("Komentár sa nepodarilo uložiť.");
      }
    };
    xhr.onerror = () => {
      if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = "Odoslať komentár"; }
      alert("Chyba siete pri ukladaní komentára.");
    };
    xhr.send(JSON.stringify({ author, text }));
  });
});