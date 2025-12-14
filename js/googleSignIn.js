// Handles Google Sign-In and keeps current user in window.currentUser + localStorage.
// IMPORTANT:
// The shared client ID used in school examples typically allows "localhost" but NOT "127.0.0.1".
// If we load the GSI script on a disallowed origin, it spams errors and slows down the app.

function shouldLoadGsi() {
  const h = (location.hostname || "").toLowerCase();
  if (location.protocol === "file:") return false;
  // Disallowed in practice for the provided client ID
  if (h === "127.0.0.1") return false;
  // Allowed: localhost + typical deployments
  if (h === "localhost") return true;
  if (h.endsWith(".netlify.app")) return true;
  if (h.endsWith(".tuke.sk")) return true;
  return false;
}

function loadGsiScript() {
  return new Promise((resolve, reject) => {
    if (document.querySelector('script[data-gsi="1"]')) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true;
    s.defer = true;
    s.dataset.gsi = "1";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Failed to load Google Sign-In script"));
    document.head.appendChild(s);
  });
}

// Decode JWT payload using proper UTF-8 handling
function decodeJwtPayload(token) {
  const base64Url = token.split(".")[1];
  const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  const jsonPayload = decodeURIComponent(
    atob(base64)
      .split("")
      .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
      .join("")
  );

  return JSON.parse(jsonPayload);
}

function onGoogleSignIn(response) {
  const payload = decodeJwtPayload(response.credential);
  const name = payload.name;
  const email = payload.email;

  window.currentUser = { name, email };
  localStorage.setItem("currentUser", JSON.stringify(window.currentUser));

  updateUserUI();
}

// Updates header UI based on currentUser
function updateUserUI() {
  const userInfo = document.getElementById("user-info");
  const loginButton = document.querySelector(".g_id_signin");
  const logoutButton = document.getElementById("logout-btn");
  const user = window.currentUser;

  if (!userInfo || !loginButton || !logoutButton) {
    // Avoid crashes if layout changes
    return;
  }

  if (user) {
    userInfo.textContent = `Signed in as: ${user.name} (${user.email})`;
    loginButton.style.display = "none";
    logoutButton.hidden = false;
  } else {
    userInfo.textContent = "You are not signed in.";
    loginButton.style.display = "inline-block";
    logoutButton.hidden = true;
  }
}

// Clears currentUser and updates UI
function onGoogleSignOut() {
  window.currentUser = null;
  localStorage.removeItem("currentUser");
  updateUserUI();
}

document.addEventListener("DOMContentLoaded", () => {
  const storedUser = localStorage.getItem("currentUser");
  if (storedUser) {
    try {
      window.currentUser = JSON.parse(storedUser);
    } catch (e) {
      console.error("Invalid currentUser JSON in localStorage", e);
      window.currentUser = null;
    }
  }

  updateUserUI();

  // Load Google Sign-In script only on allowed origins.
  const loginButton = document.querySelector(".g_id_signin");
  const userInfo = document.getElementById("user-info");
  if (shouldLoadGsi()) {
    loadGsiScript().catch((e) => {
      console.warn("Google Sign-In script failed to load:", e);
      if (loginButton) loginButton.style.display = "none";
      if (userInfo) userInfo.textContent = "Google Sign-In nie je dostupné.";
    });
  } else {
    // On 127.0.0.1 the provided client ID rejects the origin → noisy 403 + slow.
    if ((location.hostname || "") === "127.0.0.1") {
      if (loginButton) loginButton.style.display = "none";
      if (userInfo) userInfo.textContent = "Google Sign-In nefunguje na 127.0.0.1. Použi http://localhost:5500.";
    }
  }

  const logoutButton = document.getElementById("logout-btn");
  if (logoutButton) {
    logoutButton.addEventListener("click", onGoogleSignOut);
  }
});