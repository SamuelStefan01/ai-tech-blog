// Bootstraps router

import { ParamHashRouter } from "./paramHashRouter.js";
import { routes } from "./routes.js";
import "./mainMenu.js";
import "./addOpinion.js";
import "./themeToggle.js"

const router = new ParamHashRouter(routes);

export default router;