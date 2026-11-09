import mongoose from "mongoose";

// One document per browser/device that agreed to receive notifications.
const pushSubscriptionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    endpoint: { type: String, required: true, unique: true, maxlength: 1000 },
    keys: {
      p256dh: { type: String, required: true, maxlength: 200 },
      auth: { type: String, required: true, maxlength: 100 },
    },
    label: { type: String, maxlength: 80, default: "" },
    userAgent: { type: String, maxlength: 400, default: "" },
    lastSuccessAt: { type: Date, default: null },
    failures: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const PushSubscription = mongoose.model("PushSubscription", pushSubscriptionSchema);

// VAPID key pair, generated once if not supplied through the environment.
const pushConfigSchema = new mongoose.Schema(
  {
    publicKey: { type: String, required: true },
    privateKey: { type: String, required: true, select: false },
  },
  { timestamps: true },
);

export const PushConfig = mongoose.model("PushConfig", pushConfigSchema);
