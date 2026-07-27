import Settings from "../modules/settings/settings.model.js";

/*
  Lets the admin flip a switch in Settings to fully disable the public
  /auth/register + /auth/login (and forgot/reset password) endpoints,
  e.g. to force Google-only sign-in. Google login and refresh-token/
  logout/me (needed by already-authenticated sessions of either kind)
  are never gated by this.

  No Settings document yet (fresh install, before the admin has saved
  settings once) is treated as "enabled" so first-time setup isn't
  blocked.
*/
const requirePasswordAuthEnabled = async (req, res, next) => {
  try {
    const settings = await Settings.findOne({})
      .select("passwordAuthEnabled")
      .lean();

    if (settings && settings.passwordAuthEnabled === false) {
      return res.status(403).json({
        success: false,
        message:
          "Password authentication is currently disabled. Please sign in with Google.",
      });
    }

    next();
  } catch (error) {
    next(error);
  }
};

export default requirePasswordAuthEnabled;
