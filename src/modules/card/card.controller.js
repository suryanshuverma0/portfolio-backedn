import { getCardForAdmin, updateCard, getPublicCard, buildVCard } from "./card.service.js";
import { getCardAnalytics } from "./card.analytics.js";
import { isValidTimezone } from "../analytics/journey.service.js";

export const getPublicCardController = async (req, res, next) => {
  try {
    const card = await getPublicCard();

    if (!card) {
      return res.status(404).json({ success: false, message: "Card not available" });
    }

    res.status(200).json({ success: true, data: card });
  } catch (error) {
    next(error);
  }
};

export const downloadVCardController = async (req, res, next) => {
  try {
    const vcard = await buildVCard();

    if (!vcard) {
      return res.status(404).json({ success: false, message: "Card not available" });
    }

    // "inline" lets iOS Safari open the Add Contact sheet directly; Android
    // browsers download the file and hand it to the Contacts app.
    res.setHeader("Content-Type", "text/vcard; charset=utf-8");
    res.setHeader("Content-Disposition", `inline; filename="${vcard.filename}"`);
    res.setHeader("Cache-Control", "public, max-age=300");
    res.status(200).send(vcard.content);
  } catch (error) {
    next(error);
  }
};

export const getAdminCardController = async (req, res, next) => {
  try {
    const card = await getCardForAdmin();

    res.status(200).json({ success: true, data: card });
  } catch (error) {
    next(error);
  }
};

export const updateCardController = async (req, res, next) => {
  try {
    const card = await updateCard(req.user._id, req.validatedData);

    res.status(200).json({ success: true, message: "Card updated", data: card });
  } catch (error) {
    next(error);
  }
};

export const getCardAnalyticsController = async (req, res, next) => {
  try {
    const range = Math.min(365, Math.max(1, Number.parseInt(req.query.range, 10) || 30));
    const timezone =
      typeof req.query.tz === "string" && isValidTimezone(req.query.tz) ? req.query.tz : "UTC";

    const data = await getCardAnalytics(range, timezone);

    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
};
