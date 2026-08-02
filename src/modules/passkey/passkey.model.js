import mongoose from "mongoose";

const passkeySchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Base64URL credential ID reported by the authenticator — globally
    // unique, and how a usernameless login looks the owning user up.
    credentialID: {
      type: String,
      required: true,
      unique: true,
    },

    // COSE public key bytes only. The private key never leaves the
    // authenticator and is never seen by this server.
    publicKey: {
      type: Buffer,
      required: true,
    },

    // Signature counter reported by the authenticator, used to detect
    // cloned credentials (should only ever increase).
    counter: {
      type: Number,
      required: true,
      default: 0,
    },

    transports: {
      type: [String],
      default: [],
    },

    deviceType: {
      type: String,
      enum: ["singleDevice", "multiDevice"],
      required: true,
    },

    backedUp: {
      type: Boolean,
      default: false,
    },

    // User-facing label so someone with several passkeys ("iPhone",
    // "YubiKey") can tell them apart when renaming/deleting.
    name: {
      type: String,
      trim: true,
      maxlength: 100,
      default: "Passkey",
    },

    lastUsedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

const Passkey = mongoose.model("Passkey", passkeySchema);
export default Passkey;
