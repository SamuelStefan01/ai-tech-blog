// Mobile off-canvas navigation

document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("mobile-nav-toggle");
  const body = document.body;
  if (!toggle) return;

  function openNav() {
    body.classList.add("mobile-nav-open");
    toggle.setAttribute("aria-expanded", "true");
  }

  function closeNav() {
    body.classList.remove("mobile-nav-open");
    toggle.setAttribute("aria-expanded", "false");
  }

  function toggleNav() {
    if (body.classList.contains("mobile-nav-open")) {
      closeNav();
    } else {
      openNav();
    }
  }

  toggle.addEventListener("click", toggleNav);

  // close after clicking a link
  document.querySelectorAll(".site-nav a").forEach((link) => {
    link.addEventListener("click", () => {
      if (body.classList.contains("mobile-nav-open")) {
        closeNav();
      }
    });
  });

  // close = ESC
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && body.classList.contains("mobile-nav-open")) {
      closeNav();
      toggle.focus();
    }
  });

  // close when clicking outside
  document.addEventListener("click", (e) => {
    if (!body.classList.contains("mobile-nav-open")) return;

    const headerRight = document.querySelector(".header-right");
    const isClickInside =
      headerRight && headerRight.contains(e.target) ||
      toggle.contains(e.target);

    if (!isClickInside) {
      closeNav();
    }
  });
});
