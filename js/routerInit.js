// Bootstraps router

import { ParamHashRouter } from "./paramHashRouter.js";
import { routes } from "./routes.js";
import "./mainMenu.js";
import "./addOpinion.js";
import "./themeToggle.js"

const router = new ParamHashRouter(routes);

export default router;

try {
  // your existing router init
} catch (e) {
  console.error(e);
  const rv = document.getElementById("router-view");
  if (rv) rv.innerHTML = "<p>App failed to start. Check console.</p>";
}