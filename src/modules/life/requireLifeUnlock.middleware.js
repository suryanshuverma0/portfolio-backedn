import { readUnlock, issueUnlock, clearUnlock } from "./lifeLock.service.js";

/*
  Guards the personal side (notes, planner, vault …). Runs after
  protectAdmin. Answers 423 Locked with a code the admin app listens for,
  and slides the idle deadline on every request that gets through.
*/
const requireLifeUnlock = async (req, res, next) => {
  try {
    const { configured, unlocked, lock, token } = await readUnlock(req);
    if (!configured) {
      return res.status(423).json({ success: false, code: "LIFE_SETUP_REQUIRED", message: "Set up the life lock to open your personal space" });
    }
    if (!unlocked) {
      clearUnlock(res);
      return res.status(423).json({ success: false, code: "LIFE_LOCKED", message: "Your personal space is locked" });
    }
    req.lifeExpiresAt = issueUnlock(res, lock, token.st);
    req.lifeUnlocked = true;
    return next();
  } catch (error) {
    return next(error);
  }
};

export default requireLifeUnlock;
