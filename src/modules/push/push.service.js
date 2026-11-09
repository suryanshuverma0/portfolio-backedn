import webpush from "web-push";

import { PushSubscription, PushConfig } from "./push.model.js";
import logger from "../../utils/logger.js";

/* ---------------------------------------------------------------------------
   Web Push — notifications on the admin's phone, tablet and laptop, even
   when the admin panel is closed (installed as an app on iOS 16.4+).

   VAPID keys come from VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY when set;
   otherwise a pair is generated once and kept in the database, so push
   works with no extra setup. Changing keys invalidates existing
   subscriptions (devices simply re-enable notifications).
--------------------------------------------------------------------------- */

const MAX_FAILURES = 5;

let vapid = null;

const getVapid = async () => {
  if (vapid) return vapid;

  if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    vapid = { publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY };
  } else {
    let config = await PushConfig.findOne({}).select("+privateKey").lean();
    if (!config) {
      const keys = webpush.generateVAPIDKeys();
      config = (await PushConfig.create(keys)).toObject();
      logger.info({ action: "PUSH_VAPID_GENERATED" });
    }
    vapid = { publicKey: config.publicKey, privateKey: config.privateKey };
  }

  const subject = process.env.VAPID_SUBJECT || `mailto:${process.env.ADMIN_EMAIL || process.env.EMAIL_FROM || "admin@example.com"}`;
  webpush.setVapidDetails(subject.startsWith("mailto:") || subject.startsWith("https:") ? subject : `mailto:${subject}`, vapid.publicKey, vapid.privateKey);

  return vapid;
};

export const getPublicKey = async () => (await getVapid()).publicKey;

export const subscribe = async (userId, { subscription, label, userAgent }) => {
  const doc = await PushSubscription.findOneAndUpdate(
    { endpoint: subscription.endpoint },
    {
      $set: {
        userId,
        keys: subscription.keys,
        label: (label || "").slice(0, 80),
        userAgent: (userAgent || "").slice(0, 400),
        failures: 0,
      },
    },
    { upsert: true, returnDocument: "after" },
  ).lean();
  return present(doc);
};

export const unsubscribe = (endpoint) => PushSubscription.deleteOne({ endpoint });

export const removeSubscription = (userId, id) => PushSubscription.deleteOne({ _id: id, userId });

const present = (doc) => ({
  id: String(doc._id),
  endpoint: doc.endpoint,
  label: doc.label,
  userAgent: doc.userAgent,
  createdAt: doc.createdAt,
  lastSuccessAt: doc.lastSuccessAt,
});

export const listSubscriptions = async (userId) =>
  (await PushSubscription.find({ userId }).sort({ createdAt: -1 }).lean()).map(present);

// payload: { title, body, url, tag }. Never throws — notifications are best effort.
export const sendPushToAll = async (payload) => {
  try {
    const subs = await PushSubscription.find({}).lean();
    if (!subs.length) return { sent: 0 };

    await getVapid();
    const body = JSON.stringify({
      title: String(payload.title || "Notification").slice(0, 120),
      body: String(payload.body || "").slice(0, 300),
      url: payload.url || "/dashboard",
      tag: payload.tag,
    });

    let sent = 0;
    await Promise.all(
      subs.map(async (sub) => {
        try {
          await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, body, { TTL: 60 * 60 * 24, urgency: "normal" });
          sent += 1;
          await PushSubscription.updateOne({ _id: sub._id }, { $set: { lastSuccessAt: new Date(), failures: 0 } });
        } catch (error) {
          // 404/410: the browser dropped this subscription for good.
          if (error.statusCode === 404 || error.statusCode === 410 || sub.failures + 1 >= MAX_FAILURES) {
            await PushSubscription.deleteOne({ _id: sub._id });
          } else {
            await PushSubscription.updateOne({ _id: sub._id }, { $inc: { failures: 1 } });
          }
          logger.warn({ action: "PUSH_SEND_FAILED", status: error.statusCode, error: error.message?.slice(0, 200) });
        }
      }),
    );
    return { sent };
  } catch (error) {
    logger.warn({ action: "PUSH_FAILED", error: error.message });
    return { sent: 0 };
  }
};
