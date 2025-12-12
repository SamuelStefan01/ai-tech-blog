const PALETTE_KEY = "palette";

const PALETTES = {
  fantasySky: {
    light: "palette-fantasy-sky-light",
    dark: "palette-fantasy-sky-dark",
  },
  fantasyForest: {
    light: "palette-fantasy-forest-light",
    dark: "palette-fantasy-forest-dark",
  },
  daynight: {
    light: "palette-daynight-light",
    dark: "palette-daynight-dark",
  },
  phoenix: {
    light: "palette-phoenix-light",
    dark: "palette-phoenix-dark",
  },
  darkSakura: {
    light: "palette-dark-sakura-light",
    dark: "palette-dark-sakura-dark",
  },
  moonspace: {
    light: "palette-moonspace-light",
    dark: "palette-moonspace-dark",
  },
  redSnow: {
    light: "palette-red-snow-light",
    dark: "palette-red-snow-dark",
  },
};

function getCurrentTheme() {
  const t = document.documentElement.dataset.theme;
  return t === "dark" ? "dark" : "light";
}

function clearPaletteClasses() {
  const root = document.documentElement;
  const toRemove = [];
  root.classList.forEach((cls) => {
    if (cls.startsWith("palette-")) {
      toRemove.push(cls);
    }
  });
  toRemove.forEach((cls) => root.classList.remove(cls));
}

function applyPalette(paletteKey) {
  const config = PALETTES[paletteKey] || PALETTES.fantasySky;
  const theme = getCurrentTheme();
  const className = config[theme];

  const root = document.documentElement;
  clearPaletteClasses();
  root.classList.add(className);

  localStorage.setItem(PALETTE_KEY, paletteKey);
  updatePaletteUI(paletteKey);
}

function updatePaletteUI(paletteKey) {
  const menu = document.getElementById("palette-menu");
  const label = document.getElementById("palette-current-label");
  if (!menu || !label) return;

  const options = Array.from(menu.querySelectorAll(".palette-option"));
  options.forEach((btn) => {
    const active = btn.dataset.palette === paletteKey;
    btn.classList.toggle("is-active", active);
    if (active) {
      label.textContent = btn.textContent.trim();
    }
  });
}

function openMenu() {
  const menu = document.getElementById("palette-menu");
  const toggle = document.getElementById("palette-toggle");
  if (!menu || !toggle) return;

  menu.hidden = false;
  menu.classList.add("open");
  toggle.setAttribute("aria-expanded", "true");
}

function closeMenu() {
  const menu = document.getElementById("palette-menu");
  const toggle = document.getElementById("palette-toggle");
  if (!menu || !toggle) return;

  menu.classList.remove("open");
  toggle.setAttribute("aria-expanded", "false");
  setTimeout(() => {
    if (!menu.classList.contains("open")) {
      menu.hidden = true;
    }
  }, 160);
}

window.reapplyCurrentPalette = function () {
  const stored = localStorage.getItem(PALETTE_KEY) || "fantasySky";
  applyPalette(stored);
};

function initPaletteDropdown() {
  const toggle = document.getElementById("palette-toggle");
  const menu = document.getElementById("palette-menu");
  if (!toggle || !menu) return;

  const stored = localStorage.getItem(PALETTE_KEY) || "fantasySky";
  if (!PALETTES[stored]) {
    localStorage.removeItem(PALETTE_KEY);
  }
  window.reapplyCurrentPalette();

  toggle.addEventListener("click", () => {
    const isOpen = menu.classList.contains("open");
    if (isOpen) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  menu.addEventListener("click", (e) => {
    const btn = e.target.closest(".palette-option");
    if (!btn) return;
    const key = btn.dataset.palette;
    if (!key) return;
    applyPalette(key);
    closeMenu();
  });

  document.addEventListener("click", (e) => {
    if (!menu.classList.contains("open")) return;
    if (!e.target.closest(".palette-switcher")) {
      closeMenu();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && menu.classList.contains("open")) {
      closeMenu();
      toggle.focus();
    }
  });
}

document.addEventListener("DOMContentLoaded", initPaletteDropdown);