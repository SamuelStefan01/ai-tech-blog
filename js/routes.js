import { ArticleFormsHandler } from "./articleFormsHandler.js";

const BASE_URL = "https://wt.kpi.fei.tuke.sk/api";
const articleFormsHandler = new ArticleFormsHandler(BASE_URL);

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

  const pageSize = 20;
  const offset = params && params.offset ? Number(params.offset) || 0 : 0;

  const url = `${BASE_URL}/article?max=${pageSize}&offset=${offset}`;

  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, true);

  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      handleArticlesSuccess(xhr.responseText, listTpl, target, offset, pageSize);
    } else {
      console.error("Articles request failed", xhr.status, xhr.responseText);
      target.innerHTML = Mustache.render(errorTpl.innerHTML, {});
    }
  };

  xhr.onerror = () => {
    console.error("Network error while loading articles");
    target.innerHTML = Mustache.render(errorTpl.innerHTML, {});
  };

  xhr.send();
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

  const xhr = new XMLHttpRequest();
  xhr.open("GET", url, true);

  xhr.onload = () => {
    if (xhr.status >= 200 && xhr.status < 300) {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {
        target.innerHTML = "<p>Chybná odpoveď servera.</p>";
        return;
      }

      const viewData = {
        id: data.id,
        title: data.title,
        author: data.author || "unknown",
        dateCreated: data.dateCreated ? data.dateCreated.substring(0, 10) : "",
        content: data.content || "",
        backOffset,
        comments: data.comments || []
      };

      target.innerHTML = Mustache.render(tpl.innerHTML, viewData);

      // load comments
      const commentsUrl = `${BASE_URL}/article/${encodeURIComponent(id)}/comment`;
      const xhrComments = new XMLHttpRequest();
      xhrComments.open("GET", commentsUrl, true);

      xhrComments.onload = () => {
        let comments = [];
        if (xhrComments.status >= 200 && xhrComments.status < 300) {
          try {
            comments = JSON.parse(xhrComments.responseText);
          } catch (e) {
            comments = [];
          }
        }
        viewData.comments = comments || [];
        target.innerHTML = Mustache.render(tpl.innerHTML, viewData);
        initCommentForm(id, backOffset);
      };

      xhrComments.onerror = () => {
        viewData.comments = [];
        target.innerHTML = Mustache.render(tpl.innerHTML, viewData);
        initCommentForm(id, backOffset);
      };

      xhrComments.send();
    } else {
      target.innerHTML = "<p>Nepodarilo sa načítať článok.</p>";
    }
  };

  xhr.onerror = () => {
    target.innerHTML = "<p>Chyba siete pri načítaní článku.</p>";
  };

  xhr.send();
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