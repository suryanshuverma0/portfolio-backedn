import Settings from "../modules/settings/settings.model.js";

/*
  Admin-controlled kill switch (Settings.publicAccessEnabled) for whether
  anyone other than an ADMIN_EMAILS address can register or log in, via
  either password or Google. The admin allowlist itself always bypasses
  this check regardless of the toggle.

  No Settings document yet (fresh install) is treated as "enabled" so
  first-time setup isn't blocked.
*/
export const isPublicAccessEnabled = async () => {
  const settings = await Settings.findOne({})
    .select("publicAccessEnabled")
    .lean();

  if (!settings) {
    return true;
  }

  return settings.publicAccessEnabled !== false;
};
