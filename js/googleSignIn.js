// Handles Google Sign-In and keeps current user in window.currentUser + localStorage

// Disable Google Sign-In on localhost/dev to avoid breaking the app
const isLocal = location.hostname === "127.0.0.1" || location.hostname === "localhost";
if (isLocal) {
  console.warn("Google Sign-In disabled on localhost.");
} else {
  // wrap your existing init code in try/catch
  try {
    // ... your existing google init code here ...
  } catch (e) {
    console.warn("Google Sign-In failed, continuing without it:", e);
  }
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

  const logoutButton = document.getElementById("logout-btn");
  if (logoutButton) {
    logoutButton.addEventListener("click", onGoogleSignOut);
  }
});