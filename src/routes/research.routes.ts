import { Router } from "express";
import { ResearchController } from "../controllers/research.controller.js";

const router = Router();

router.get("/", ResearchController.renderStudio);
router.get("/api/stream", ResearchController.streamResearch);
router.get("/api/run", ResearchController.apiRun);
router.post("/run", ResearchController.formRun);
router.post("/api/diagram/fix", ResearchController.fixDiagram);

export default router;
