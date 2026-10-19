import * as service from "./notes.service.js";

// Thin wrappers: every handler resolves to { success, data }.
const handle = (fn, status = 200) => async (req, res, next) => {
  try {
    const data = await fn(req);
    res.status(status).json({ success: true, data: data ?? null });
  } catch (error) {
    next(error);
  }
};

const isObjectId = (value) => /^[a-f\d]{24}$/i.test(String(value));

const idParam = (name) => (req) => {
  const value = req.params[name];
  if (!isObjectId(value)) {
    const error = new Error("Invalid id");
    error.statusCode = 400;
    throw error;
  }
  return value;
};

export const getTree = handle(() => service.getTree());

export const createNotebook = handle((req) => service.createNotebook(req.validatedData), 201);
export const updateNotebook = handle((req) => service.updateNotebook(idParam("id")(req), req.validatedData));
export const deleteNotebook = handle((req) => service.deleteNotebook(idParam("id")(req)));

export const createTopic = handle((req) => service.createTopic(req.validatedData), 201);
export const updateTopic = handle((req) => service.updateTopic(idParam("id")(req), req.validatedData));
export const deleteTopic = handle((req) => service.deleteTopic(idParam("id")(req)));

export const createNote = handle((req) => service.createNote(req.validatedData), 201);
export const getNote = handle((req) => service.getNote(idParam("id")(req)));
export const updateNote = handle((req) => service.updateNote(idParam("id")(req), req.validatedData));
export const deleteNote = handle((req) => service.deleteNote(idParam("id")(req)));

export const reorder = handle((req) => service.reorder(req.validatedData));

export const search = handle((req) =>
  service.searchNotes({
    q: typeof req.query.q === "string" ? req.query.q.trim().slice(0, 100) : "",
    tag: typeof req.query.tag === "string" ? req.query.tag.trim().slice(0, 40) : "",
  }),
);
export const tags = handle(() => service.getTags());

export const listVersions = handle((req) => service.listVersions(idParam("id")(req)));
export const getVersion = handle((req) => service.getVersion(idParam("id")(req), idParam("versionId")(req)));
export const restoreVersion = handle((req) => service.restoreVersion(idParam("id")(req), idParam("versionId")(req)));

const batchParam = (req) => {
  const value = String(req.params.batch || "");
  if (!/^[0-9a-f-]{36}$/i.test(value)) {
    const error = new Error("Invalid trash item");
    error.statusCode = 400;
    throw error;
  }
  return value;
};

export const listTrash = handle(() => service.listTrash());
export const restoreTrash = handle((req) => service.restoreBatch(batchParam(req)));
export const purgeTrash = handle((req) => service.purgeBatch(batchParam(req)));
export const emptyTrash = handle(() => service.emptyTrash());
