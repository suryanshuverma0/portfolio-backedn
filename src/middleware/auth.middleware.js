import jwt from "jsonwebtoken";

import User from "../modules/auth/auth.model.js";

const protect = async (
  req,
  res,
  next,
) => {
  try {
    const token =
      req.cookies.accessToken;

    if (!token) {
      return res.status(401).json({
        success: false,

        message:
          "Unauthorized access",
      });
    }

    const decoded = jwt.verify(
      token,
      process.env.ACCESS_TOKEN_SECRET,
    );

    const user =
      await User.findById(
        decoded.id,
      ).select("-password");

    if (!user) {
      return res.status(401).json({
        success: false,

        message:
          "User not found",
      });
    }

    req.user = user;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,

      message:
        "Invalid or expired token",
    });
  }
};

export default protect;
