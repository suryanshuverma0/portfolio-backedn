import Project from "./project.model.js";
import { deleteImage } from "../upload/upload.service.js";
import logger from "../../utils/logger.js";

const collectPublicIds = (project) => {
  const ids = [];

  if (project.thumbnail?.publicId) {
    ids.push(project.thumbnail.publicId);
  }

  (project.gallery || []).forEach(
    (image) => image?.publicId && ids.push(image.publicId),
  );

  (project.architectureImages || []).forEach(
    (image) => image?.publicId && ids.push(image.publicId),
  );

  return ids;
};

export const createProject = async (userId, projectData) => {
  const project = await Project.create({
    user: userId,
    ...projectData,
  });

  logger.info({
    action: "CREATE_PROJECT",
    userId,
    projectId: project._id,
  });

  return project;
};

export const getProjects = async (userId) => {
  return await Project.find({
    user: userId,
  }).sort({ order: 1 });
};

export const getPublicProjects = async () => {
  return await Project.find({
    isVisible: true,
  }).sort({ order: 1 });
};

export const getPublicProjectBySlug = async (slug) => {
  const project = await Project.findOne({
    slug,
    isVisible: true,
  });

  if (!project) {
    throw new Error("Project not found");
  }

  return project;
};

export const updateProject = async (projectId, userId, updateData) => {
  const existingProject = await Project.findOne({
    _id: projectId,
    user: userId,
  });

  if (!existingProject) {
    logger.warn({
      action: "UPDATE_PROJECT",
      userId,
      projectId,
      message: "Project not found",
    });

    throw new Error("Project not found");
  }

  const oldPublicIds = collectPublicIds(existingProject);
  const newPublicIds = collectPublicIds({
    ...existingProject.toObject(),
    ...updateData,
  });
  const removedPublicIds = oldPublicIds.filter(
    (id) => !newPublicIds.includes(id),
  );

  await Promise.all(removedPublicIds.map((id) => deleteImage(id)));

  const project = await Project.findByIdAndUpdate(
    projectId,
    {
      $set: updateData,
    },
    {
      new: true,
      runValidators: true,
    },
  );

  logger.info({
    action: "UPDATE_PROJECT",
    userId,
    projectId,
  });

  return project;
};

export const deleteProject = async (projectId, userId) => {
  const project = await Project.findOneAndDelete({
    _id: projectId,
    user: userId,
  });

  if (!project) {
    logger.warn({
      action: "DELETE_PROJECT",
      userId,
      projectId,
      message: "Project not found",
    });

    throw new Error("Project not found");
  }

  await Promise.all(
    collectPublicIds(project).map((id) => deleteImage(id)),
  );

  logger.info({
    action: "DELETE_PROJECT",
    userId,
    projectId,
  });

  return project;
};
