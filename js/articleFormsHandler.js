export class ArticleFormsHandler {
  constructor(baseUrl) {
    this.baseUrl = baseUrl;
  }

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

    const renderForm = (articleData = {}) => {
      const currentUser = window.currentUser || null;

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

      form.addEventListener("submit", (e) => {
        e.preventDefault();

        const formData = new FormData(form);
        const title = (formData.get("title") || "").toString().trim();
        const author = (formData.get("author") || "").toString().trim();
        const content = (formData.get("content") || "").toString().trim();

        if (!title || !author || !content) {
          alert("Vyplň všetky povinné polia (nadpis, autor, obsah).");
          return;
        }

        const payload = { title, author, content };

        const onSuccess = (article) => {
          const newId = (article && article.id) || id;
          if (newId) {
            window.location.hash = `#article?id=${newId}&offset=${backOffset}`;
          } else {
            window.location.hash = `#articles?offset=${backOffset}`;
          }
        };

        const onError = (msg) => {
          alert(msg || "Ukladanie článku zlyhalo.");
        };

        if (mode === "edit") {
          if (!id) {
            alert("Chýba ID článku na úpravu.");
            return;
          }
          this.submitEdit(id, payload, onSuccess, onError);
        } else {
          this.submitInsert(payload, onSuccess, onError);
        }
      });
    };

    if (mode === "edit") {
      if (!id) {
        target.innerHTML = "<p>Missing article ID.</p>";
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
      onError && onError("Chyba siete pri ukladaní článku.");
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

    const confirmed = window.confirm("Naozaj chceš zmazať tento článok?");
    if (!confirmed) {
      window.location.hash = `#article?id=${id}&offset=${backOffset}`;
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