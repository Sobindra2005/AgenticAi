import { Router } from "express";
import { ThreadController } from "../controllers/thread.controller.js";

const router = Router();

router.get("/", ThreadController.getAllThreads);
router.post("/", ThreadController.createThread);
router.get("/:id/messages", ThreadController.getThreadMessages);
router.get("/:id/sources", ThreadController.getThreadSources);
router.get("/:id/kb", ThreadController.getThreadKb);
router.get("/:id/traces", ThreadController.getThreadTraces);
router.get("/:id", ThreadController.getThreadById);
router.put("/:id", ThreadController.updateThread);
router.post("/:id/save", ThreadController.saveThreadAssets);
router.delete("/:id", ThreadController.deleteThread);
router.post("/:id/clear", ThreadController.clearThread);
router.put("/:id/messages/:messageId/report", ThreadController.updateMessageReport);

export default router;
