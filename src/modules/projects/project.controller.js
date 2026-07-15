import {
  createProject,
  getProjects,
  getPublicProjects,
  getPublicProjectBySlug,
  updateProject,
  deleteProject,
} from "./project.service.js";

export const createProjectController = async (req, res, next) => {
  try {
    const project = await createProject(req.user._id, req.validatedData);

    res.status(201).json({
      success: true,
      message: "Project created successfully",
      data: project,
    });
  } catch (error) {
    next(error);
  }
};

export const getProjectsController = async (req, res, next) => {
  try {
    const projects = await getProjects(req.user._id);

    res.status(200).json({
      success: true,
      data: projects,
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicProjectsController = async (req, res, next) => {
  try {
    const projects = await getPublicProjects();

    res.status(200).json({
      success: true,
      data: projects,
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicProjectController = async (req, res, next) => {
  try {
    const project = await getPublicProjectBySlug(req.params.slug);

    res.status(200).json({
      success: true,
      data: project,
    });
  } catch (error) {
    next(error);
  }
};

export const updateProjectController = async (req, res, next) => {
  try {
    const project = await updateProject(
      req.params.id,
      req.user._id,
      req.validatedData,
    );

    res.status(200).json({
      success: true,
      message: "Project updated successfully",
      data: project,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteProjectController = async (req, res, next) => {
  try {
    await deleteProject(req.params.id, req.user._id);

    res.status(200).json({
      success: true,
      message: "Project deleted successfully",
    });
  } catch (error) {
    next(error);
  }
};
