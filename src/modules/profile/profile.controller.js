import {
  createProfile,
  getProfile,
  updateProfile,
    getPublicProfile,
} from "./profile.service.js";

export const createProfileController = async (
  req,
  res,
  next
) => {
  try {
    const profile = await createProfile(
      req.user._id,
      req.validatedData
    );

    res.status(201).json({
      success: true,
      message: "Profile created successfully",
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};

export const getProfileController = async (
  req,
  res,
  next
) => {
  try {
    const profile = await getProfile(
      req.user._id
    );

    res.status(200).json({
      success: true,
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};

export const updateProfileController = async (
  req,
  res,
  next
) => {
  try {
    const profile = await updateProfile(
      req.user._id,
      req.validatedData
    );

    res.status(200).json({
      success: true,
      message: "Profile updated successfully",
      data: profile,
    });
  } catch (error) {
    next(error);
  }
};

export const getPublicProfileController =
  async (req, res, next) => {
    try {
      const profile =
        await getPublicProfile();

      res.status(200).json({
        success: true,
        data: profile,
      });
    } catch (error) {
      next(error);
    }
  };