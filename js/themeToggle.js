// Dark / light mode switch controlled by checkbox #theme-toggle

const THEME_KEY = "theme";

function getPreferredTheme() {
  const stored = localStorage.getItem(THEME_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }

  if (window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function applyTheme(theme) {
  const root = document.documentElement;
  const toggle = document.getElementById("theme-toggle");

  const normalized = theme === "dark" ? "dark" : "light";

  root.dataset.theme = normalized;
  localStorage.setItem(THEME_KEY, normalized);

  if (toggle) {
    toggle.checked = normalized === "dark";
  }

  // if you use paletteToggle.js, re-apply palette when theme changes
  if (typeof window.reapplyCurrentPalette === "function") {
    window.reapplyCurrentPalette();
  }
}

function initThemeToggle() {
  const toggle = document.getElementById("theme-toggle");
  const initialTheme = getPreferredTheme();
  applyTheme(initialTheme);

  if (toggle) {
    toggle.addEventListener("change", (e) => {
      const isDark = e.target.checked;
      applyTheme(isDark ? "dark" : "light");
    });
  }
}

document.addEventListener("DOMContentLoaded", initThemeToggle);