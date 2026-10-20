import express from "express";

import protectAdmin from "../../middleware/protectAdmin.middleware.js";
import validate from "../../middleware/validate.middleware.js";
import * as c from "./notes.controller.js";
import {
  notebookSchema,
  notebookUpdateSchema,
  topicSchema,
  topicUpdateSchema,
  noteCreateSchema,
  noteUpdateSchema,
  reorderSchema,
  publishSchema,
} from "./notes.validation.js";

// Private notes — every route is admin-only.
const router = express.Router();
router.use(protectAdmin);

router.get("/tree", c.getTree);
router.get("/search", c.search);
router.get("/tags", c.tags);
router.post("/reorder", validate(reorderSchema), c.reorder);

router.post("/notebooks", validate(notebookSchema), c.createNotebook);
router.patch("/notebooks/:id", validate(notebookUpdateSchema), c.updateNotebook);
router.delete("/notebooks/:id", c.deleteNotebook);

router.post("/topics", validate(topicSchema), c.createTopic);
router.patch("/topics/:id", validate(topicUpdateSchema), c.updateTopic);
router.delete("/topics/:id", c.deleteTopic);

router.get("/trash", c.listTrash);
router.delete("/trash", c.emptyTrash);
router.post("/trash/:batch/restore", c.restoreTrash);
router.delete("/trash/:batch", c.purgeTrash);

router.post("/", validate(noteCreateSchema), c.createNote);
router.get("/:id", c.getNote);
router.patch("/:id", validate(noteUpdateSchema), c.updateNote);
router.delete("/:id", c.deleteNote);
router.get("/:id/pdf", c.exportPdf);
router.get("/:id/publish", c.publishStatus);
router.post("/:id/publish", validate(publishSchema), c.publish);
router.post("/:id/unpublish", c.unpublish);
router.get("/:id/versions", c.listVersions);
router.get("/:id/versions/:versionId", c.getVersion);
router.post("/:id/versions/:versionId/restore", c.restoreVersion);

export default router;
