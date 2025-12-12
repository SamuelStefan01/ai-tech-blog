// Handles visitor opinion form and localStorage

function getOpinions() {
  const raw = localStorage.getItem("opinions");
  try {
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Invalid opinions JSON", e);
    return [];
  }
}

function saveOpinions(list) {
  localStorage.setItem("opinions", JSON.stringify(list));
}

// Convert rating number to "★★★★★" string
function ratingToStars(n) {
  const val = Number(n) || 0;
  return "★★★★★".slice(0, Math.max(0, Math.min(5, val)));
}

// Build display texts
function buildOpinionObject(formData) {
  const now = new Date();
  const dateOnly = now.toISOString().substring(0, 10);

  const ratingNumber = Number(formData.rating);
  const stars = ratingToStars(ratingNumber);

  const keywords = (formData.keywords || "")
    .split(",")
    .map(k => k.trim())
    .filter(Boolean);

  return {
    id: Date.now(),
    name: formData.name.trim(),
    email: formData.email.trim(),
    ratingNumber,
    stars,
    preferenceText: formData.preference || "neuvedené",
    willReturnText: formData.willReturn || "neuvedené",
    satisfaction: formData.satisfaction || "neuvedené",
    hasKeywords: keywords.length > 0,
    keywordsText: keywords.join(", "),
    text: formData.text.trim(),
    imageUrl: formData.imageUrl.trim() || "",
    dateOnly
  };
}

// Read values from form element
function getFormData(form) {
  const data = new FormData(form);
  return {
    name: data.get("name") || "",
    email: data.get("email") || "",
    rating: data.get("rating") || "",
    preference: data.get("preference") || "",
    willReturn: data.get("willReturn") || "",
    satisfaction: data.get("satisfaction") || "",
    keywords: data.get("keywords") || "",
    imageUrl: data.get("imageUrl") || "",
    text: data.get("text") || ""
  };
}

// Simple required-field validation
function isValid(formData) {
  if (!formData.name.trim()) return false;
  if (!formData.email.trim()) return false;
  if (!formData.text.trim()) return false;
  const r = Number(formData.rating);
  if (!r || r < 1 || r > 5) return false;
  return true;
}

// Init form: called from routes.js after template is mounted
export function initOpinionForm() {
  const form = document.getElementById("opinion-form");
  if (!form) return;

  const user = window.currentUser;
  if (user) {
    if (form.elements["name"]) form.elements["name"].value = user.name;
    if (form.elements["email"]) form.elements["email"].value = user.email;
  }

  form.addEventListener("submit", (e) => {
    e.preventDefault();

    const formData = getFormData(form);
    if (!isValid(formData)) {
      alert("Vyplňte prosím všetky povinné polia a zvoľte hodnotenie 1–5.");
      return;
    }

    const opinions = getOpinions();
    const newOpinion = buildOpinionObject(formData);
    opinions.unshift(newOpinion); // newest first
    saveOpinions(opinions);

    form.reset();

    // Go to opinions route as required
    window.location.hash = "#opinions";
  });
}

// Expose init to window for routes.js
window.initOpinionForm = initOpinionForm;