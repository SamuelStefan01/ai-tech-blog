function syncActiveLink() {
  const hash = (window.location.hash.replace(/^#/, "") || "welcome").split("?")[0];
  const links = document.querySelectorAll(".site-nav a[data-route]");

  links.forEach(link => {
    const route = link.getAttribute("data-route");
    link.classList.toggle("active", route === hash);
  });
}

window.addEventListener("hashchange", syncActiveLink);
document.addEventListener("DOMContentLoaded", syncActiveLink);