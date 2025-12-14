export class ArticleFormsHandler {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

  // AWT11 supplementary: unique hidden tag to isolate our articles on the shared server.
  static MY_TAG = "boss_ai_tech_2025";

  /**
   * Zobrazí formulár na pridanie / úpravu článku.
   * options: {
   *   mode: "insert" | "edit",
   *   id?: string,
   *   offset?: number
   * }
   */
  showForm(targetElm, options = {}) {
    const target = document.getElementById(targetElm);
    const tpl = document.getElementById("template-article-form");

    if (!target || !tpl) {
      console.error("ArticleFormsHandler.showForm: missing target element or template.");
      return;
    }

    const mode = options.mode === "edit" ? "edit" : "insert";
    const id = options.id;
    const backOffset = options.offset ? Number(options.offset) || 0 : 0;

    const isLocalId = (val) => String(val || "").startsWith("local-");

    const loadLocalArticle = (localId) => {
      try {
        const key = "local_articles_v1";
        const current = JSON.parse(localStorage.getItem(key) || "[]");
        return (current || []).find(a => String(a.id) === String(localId)) || null;
      } catch (_) {
        return null;
      }
    };

    const upsertLocalArticle = (localId, data) => {
      const key = "local_articles_v1";
      const current = JSON.parse(localStorage.getItem(key) || "[]");
      const idx = (current || []).findIndex(a => String(a.id) === String(localId));
      if (idx >= 0) current[idx] = { ...current[idx], ...data, id: localId, __local: true };
      else current.unshift({ ...data, id: localId, __local: true });
      localStorage.setItem(key, JSON.stringify(current));
      return (current || []).find(a => String(a.id) === String(localId));
    };

    const renderForm = (articleData = {}) => {
      const currentUser = window.currentUser || null;
      const existingTags = Array.isArray(articleData.tags) ? articleData.tags : [];

      const viewData = {
        isEdit: mode === "edit",
        id,
        backOffset,
        title: articleData.title || "",
        author:
          articleData.author ||
          (currentUser && currentUser.name) ||
          "",
        content: articleData.content || ""
      };

      target.innerHTML = Mustache.render(tpl.innerHTML, viewData);

      const form = document.getElementById("article-edit-form");
      if (!form) {
        console.error("ArticleFormsHandler.showForm: form not found after render.");
        return;
      }

      // IMPORTANT UX + RELIABILITY:
      // Re-rendering routes can accidentally stack listeners in some setups.
      // Using onsubmit guarantees exactly one active handler per render.
      form.onsubmit = (e) => {
        e.preventDefault();

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.dataset._origText = submitBtn.textContent;
          submitBtn.textContent = "Ukladám...";
        }

        const restoreSubmit = () => {
          if (!submitBtn) return;
          submitBtn.disabled = false;
          submitBtn.textContent = submitBtn.dataset._origText || "Uložiť";
        };

        const formData = new FormData(form);
        const title = (formData.get("title") || "").toString().trim();
        const author = (formData.get("author") || "").toString().trim();
        const content = (formData.get("content") || "").toString().trim();

        if (!title || !author || !content) {
          alert("Vyplň všetky povinné polia (nadpis, autor, obsah).");
          restoreSubmit();
          return;
        }

        // Keep tags hidden from user, but ensure ONLY our unique tag is used for project isolation.
        // This prevents "foreign" project tags (e.g. from other students/projects) from sticking around.
        const cleaned = (existingTags || []).filter(t => {
          const s = String(t || "").trim();
          if (!s) return false;
          // drop any other "ai_tech_2025"-style project tags to avoid mixing projects
          if (s !== ArticleFormsHandler.MY_TAG && /ai_tech_2025$/i.test(s)) return false;
          return true;
        });
        const tagSet = new Set(cleaned);
        tagSet.add(ArticleFormsHandler.MY_TAG);
        const payload = { title, author, content, tags: Array.from(tagSet) };

        const onSuccess = (article) => {
          restoreSubmit();
          const newId = (article && article.id) || id;
          if (newId) {
            window.location.hash = `#article?id=${newId}&offset=${backOffset}&cOffset=0`;
          } else {
            window.location.hash = `#articles?offset=${backOffset}`;
          }
        };

        const onError = (msg) => {
          restoreSubmit();
          alert(msg || "Ukladanie článku zlyhalo.");
        };

        if (mode === "edit") {
          if (!id) {
            alert("Chýba ID článku na úpravu.");
            restoreSubmit();
            return;
          }
          // Local article edit must never call WT server.
          if (isLocalId(id)) {
            try {
              const saved = upsertLocalArticle(id, { ...payload, dateCreated: articleData.dateCreated || new Date().toISOString() });
              onSuccess && onSuccess(saved);
            } catch (_) {
              onError && onError("Nepodarilo sa uložiť lokálny článok.");
            }
          } else {
            this.submitEdit(id, payload, onSuccess, onError);
          }
        } else {
          this.submitInsert(payload, onSuccess, onError);
        }
      };
    };

    if (mode === "edit") {
      if (!id) {
        target.innerHTML = "<p>Missing article ID.</p>";
        return;
      }

      // Local articles are stored in localStorage; do not fetch from WT server.
      if (isLocalId(id)) {
        const local = loadLocalArticle(id);
        if (!local) {
          target.innerHTML = "<p>Lokálny článok nebol nájdený.</p>";
          return;
        }
        renderForm(local);
        return;
      }

      const xhr = new XMLHttpRequest();
      xhr.open("GET", `${this.baseUrl}/article/${encodeURIComponent(id)}`, true);

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          let article;
          try {
            article = JSON.parse(xhr.responseText);
          } catch (e) {
            console.error("ArticleFormsHandler.showForm: invalid JSON", e);
            target.innerHTML = "<p>Chybná odpoveď servera pri načítaní článku.</p>";
            return;
          }
          renderForm(article);
        } else {
          target.innerHTML = "<p>Nepodarilo sa načítať článok na úpravu.</p>";
        }
      };

      xhr.onerror = () => {
        target.innerHTML = "<p>Chyba siete pri načítaní článku.</p>";
      };

      xhr.send();
    } else {
      // INSERT – nový článok, len vyrenderuj prázdny formulár
      renderForm();
    }
  }

  /**
   * POST /article – vytvorenie nového článku
   */
  submitInsert(data, onSuccess, onError) {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${this.baseUrl}/article`, true);
    xhr.setRequestHeader("Content-Type", "application/json");

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let article;
        try {
          article = JSON.parse(xhr.responseText);
        } catch (e) {
          console.error("submitInsert: invalid JSON", e);
          onError("Server vrátil neplatnú odpoveď.");
          return;
        }
        onSuccess && onSuccess(article);
      } else {
        onError && onError(`Ukladanie článku zlyhalo (status ${xhr.status}).`);
      }
    };

    xhr.onerror = () => {
      // Most common dev issue: CORS blocks requests from 127.0.0.1.
      // If you're running Live Server, prefer http://localhost:5500 over http://127.0.0.1:5500.
      const hint = "\n\nTip: Ak to spúšťaš lokálne, otvor stránku cez http://localhost:5500 (nie 127.0.0.1).";

      // UX fallback for testing: allow local-only save so you can verify the form works.
      const wantLocal = window.confirm(
        "Server je nedostupný alebo blokuje požiadavku (CORS).\n\nChceš článok uložiť len lokálne (na testovanie)?"
      );
      if (wantLocal) {
        try {
          const key = "local_articles_v1";
          const current = JSON.parse(localStorage.getItem(key) || "[]");
          const localId = `local-${Date.now()}`;
          const localArt = { id: localId, ...data, dateCreated: new Date().toISOString(), __local: true };
          current.unshift(localArt);
          localStorage.setItem(key, JSON.stringify(current));
          onSuccess && onSuccess(localArt);
          return;
        } catch (_) {
          // fall through to error below
        }
      }

      onError && onError("Chyba siete pri ukladaní článku." + hint);
    };

    xhr.send(JSON.stringify(data));
  }

  /**
   * PUT /article/{id} – úprava existujúceho článku
   */
  submitEdit(id, data, onSuccess, onError) {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `${this.baseUrl}/article/${encodeURIComponent(id)}`, true);
    xhr.setRequestHeader("Content-Type", "application/json");

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let article;
        try {
          article = JSON.parse(xhr.responseText);
        } catch (e) {
          console.error("submitEdit: invalid JSON", e);
          onError("Server vrátil neplatnú odpoveď.");
          return;
        }
        onSuccess && onSuccess(article);
      } else {
        onError && onError(`Úprava článku zlyhala (status ${xhr.status}).`);
      }
    };

    xhr.onerror = () => {
      onError && onError("Chyba siete pri úprave článku.");
    };

    xhr.send(JSON.stringify(data));
  }

  /**
   * DELETE /article/{id} – zmazanie článku a návrat na zoznam
   * params: { id: string, offset?: number }
   */
  deleteArticleAndGoBack(targetElm, params = {}) {
    const target = document.getElementById(targetElm);
    const id = params.id;
    const backOffset = params.offset ? Number(params.offset) || 0 : 0;

    if (!id) {
      if (target) {
        target.innerHTML = "<p>Missing article ID.</p>";
      }
      return;
    }

    const isLocalId = (val) => String(val || "").startsWith("local-");
    const deleteLocalArticle = (localId) => {
      try {
        const key = "local_articles_v1";
        const current = JSON.parse(localStorage.getItem(key) || "[]");
        const next = (current || []).filter(a => String(a.id) !== String(localId));
        localStorage.setItem(key, JSON.stringify(next));
        // also remove local comments for this article
        try { localStorage.removeItem(`local_comments_v1_${localId}`); } catch (_) {}
        return true;
      } catch (_) {
        return false;
      }
    };

    const confirmed = window.confirm("Naozaj chceš zmazať tento článok?");
    if (!confirmed) {
      window.location.hash = `#article?id=${id}&offset=${backOffset}`;
      return;
    }

    // Local-only deletion
    if (isLocalId(id)) {
      const ok = deleteLocalArticle(id);
      if (!ok) {
        alert("Nepodarilo sa zmazať lokálny článok.");
        if (target) target.innerHTML = "<p>Nepodarilo sa zmazať lokálny článok.</p>";
        return;
      }
      window.location.hash = `#articles?offset=${backOffset}`;
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.open("DELETE", `${this.baseUrl}/article/${encodeURIComponent(id)}`, true);

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        window.location.hash = `#articles?offset=${backOffset}`;
      } else {
        alert("Nepodarilo sa zmazať článok.");
        if (target) {
          target.innerHTML = "<p>Nepodarilo sa zmazať článok.</p>";
        }
      }
    };

    xhr.onerror = () => {
      alert("Chyba siete pri mazaní článku.");
      if (target) {
        target.innerHTML = "<p>Chyba siete pri mazaní článku.</p>";
      }
    };

    xhr.send();
  }
}