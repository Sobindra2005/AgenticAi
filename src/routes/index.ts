import { Router } from "express";
import threadRoutes from "./thread.routes.js";
import researchRoutes from "./research.routes.js";

const apiRouter = Router();

apiRouter.use("/threads", threadRoutes);

export { apiRouter, researchRoutes };
