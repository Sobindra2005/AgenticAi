import { Router } from "express";
import { ThreadController } from "../controllers/thread.controller.js";

const router = Router();

router.get("/", ThreadController.getAllThreads);
router.post("/", ThreadController.createThread);
router.get("/:id", ThreadController.getThreadById);
router.put("/:id", ThreadController.updateThread);
router.post("/:id/save", ThreadController.saveThreadAssets);
router.delete("/:id", ThreadController.deleteThread);
router.post("/:id/clear", ThreadController.clearThread);

export default router;
