import {
  registerUser,
  loginUser,
  forgotPassword,
  resetPassword,
  logoutUser,
  getAllUsers,
  deleteUser,
} from "./auth.service.js";
import jwt from "jsonwebtoken";
import { recordLogin } from "../audit/audit.service.js";
import {
  startSession,
  rotateSession,
  revokeSession,
  revokeAllSessions,
  listSessions,
  sessionIdFromRequest,
  setAuthCookies,
} from "./session.service.js";
import { notifySecurityEvent } from "../security/security.service.js";
import { createChallenge } from "./mfa.service.js";
import User from "./auth.model.js";
export const registerController = async (req, res, next) => {
  try {
    const { email, password } = req.validatedData;

    const data = await registerUser(email, password);

    Object.assign(data, await startSession(req, data.user, "password"));

    res
      .status(201)
      .cookie("accessToken", data.accessToken, {
        httpOnly: true,

        secure: process.env.NODE_ENV === "production",

        sameSite: "none",

        maxAge: 15 * 60 * 1000,
      })
      .cookie("refreshToken", data.refreshToken, {
        httpOnly: true,

        secure: process.env.NODE_ENV === "production",

        sameSite: "none",

        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .json({
        success: true,

        message: "User registered successfully",

        data: data.user,
      });
  } catch (error) {
    next(error);
  }
};

export const loginController = async (req, res, next) => {
  try {
    const { email, password } = req.validatedData;

    let data;

    try {
      data = await loginUser(email, password);
    } catch (error) {
      recordLogin(req, { email, method: "password", success: false, reason: error.message });
      throw error;
    }

    // Two-factor on: hand back a short-lived challenge instead of a session;
    // POST /account/mfa/verify finishes the sign-in.
    const account = await User.findById(data.user.id).select("is2FAEnabled").lean();
    if (account?.is2FAEnabled) {
      const challenge = await createChallenge({ _id: data.user.id }, "password");
      return res.status(200).json({ success: true, message: "Enter your authentication code", data: { mfaRequired: true, challenge } });
    }

    recordLogin(req, { user: data.user, email, method: "password", success: true });

    Object.assign(data, await startSession(req, data.user, "password"));

    res
      .status(200)
      .cookie("accessToken", data.accessToken, {
        httpOnly: true,

        secure: process.env.NODE_ENV === "production",

        sameSite: "none",

        maxAge: 15 * 60 * 1000,
      })
      .cookie("refreshToken", data.refreshToken, {
        httpOnly: true,

        secure: process.env.NODE_ENV === "production",

        sameSite: "none",

        maxAge: 7 * 24 * 60 * 60 * 1000,
      })
      .json({
        success: true,

        message: "Login successful",

        data: data.user,
      });
  } catch (error) {
    next(error);
  }
};

export const forgotPasswordController = async (req, res, next) => {
  try {
    const { email } = req.validatedData;

    await forgotPassword(email);

    // Always the same response whether or not an account exists for this
    // email — forgotPassword() silently no-ops for unknown/ineligible
    // accounts so this endpoint can't be used to enumerate users.
    res.status(200).json({
      success: true,

      message:
        "If an account exists for that email, a reset link has been sent.",
    });
  } catch (error) {
    next(error);
  }
};

export const resetPasswordController = async (req, res, next) => {
  try {
    const { token } = req.params;

    const { password } = req.validatedData;

    const data = await resetPassword(token, password);

    res.status(200).json({
      success: true,

      message: data.message,
    });
  } catch (error) {
    next(error);
  }
};

export const logoutController = async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken;
    const sessionId = sessionIdFromRequest(req);

    if (sessionId) await revokeSession(req.user._id, sessionId, "signed_out");

    if (refreshToken) {
      const decoded = jwt.verify(
        refreshToken,
        process.env.REFRESH_TOKEN_SECRET,
        { ignoreExpiration: true },
      );

      await logoutUser(decoded.id);
    }

    res
      .clearCookie("accessToken")
      .clearCookie("refreshToken")
      .status(200)
      .json({
        success: true,

        message: "Logout successful",
      });
  } catch (error) {
    next(error);
  }
};

export const getMeController = async (req, res) => {
  res.status(200).json({
    success: true,

    user: req.user,
  });
};

export const getAllUsersController = async (req, res, next) => {
  try {
    const users = await getAllUsers();

    res.status(200).json({
      success: true,

      data: users,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteUserController = async (req, res, next) => {
  try {
    const { id } = req.params;

    await deleteUser(id, req.user._id);

    res.status(200).json({
      success: true,

      message: "User deleted",
    });
  } catch (error) {
    next(error);
  }
};

export const refreshTokenController = async (req, res, next) => {
  try {
    const refreshToken = req.cookies.refreshToken;

    const data = await rotateSession(refreshToken, req, {
      onReuse: ({ user, session, ip }) =>
        notifySecurityEvent({
          title: "A copied sign-in token was used — that device was signed out",
          body: `Session on ${[session.browser, session.os].filter(Boolean).join(" · ") || "a device"} (${user.email}) was ended after an old refresh token was replayed from ${ip || "an unknown IP"}.`,
          link: "/dashboard/security",
          ip,
        }).catch(() => {}),
    });

    setAuthCookies(res, data)
      .status(200)
      .json({
        success: true,

        message: "Access token refreshed",
      });
  } catch (error) {
    next(error);
  }
};

/* ---------- device sessions ---------- */

export const listSessionsController = async (req, res, next) => {
  try {
    res.status(200).json({ success: true, data: await listSessions(req.user._id, req.sessionId) });
  } catch (error) {
    next(error);
  }
};

export const revokeSessionController = async (req, res, next) => {
  try {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
      return res.status(400).json({ success: false, message: "Invalid session id" });
    }

    const revoked = await revokeSession(req.user._id, req.params.id, "remote");

    if (!revoked) return res.status(404).json({ success: false, message: "Session not found or already ended" });

    res.status(200).json({ success: true, message: "Device signed out" });
  } catch (error) {
    next(error);
  }
};

export const revokeOtherSessionsController = async (req, res, next) => {
  try {
    const count = await revokeAllSessions(req.user._id, "signed_out_everywhere", { except: req.sessionId });

    res.status(200).json({ success: true, message: `Signed out ${count} other device${count === 1 ? "" : "s"}`, data: { count } });
  } catch (error) {
    next(error);
  }
};
