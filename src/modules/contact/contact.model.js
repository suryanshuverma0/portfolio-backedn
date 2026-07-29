import mongoose from "mongoose";

const messageSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: 100,
    },

    // Indexed — the whole point of this module is being able to look up
    // everything a given person has sent, later.
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      maxlength: 200,
      index: true,
    },

    subject: {
      type: String,
      trim: true,
      maxlength: 200,
    },

    message: {
      type: String,
      required: [true, "Message is required"],
      trim: true,
      maxlength: 3000,
    },

    isRead: {
      type: Boolean,
      default: false,
    },

    // Whether the automatic acknowledgment email actually went out —
    // false just means Resend wasn't reachable/configured, not that
    // anything is wrong with the message itself.
    autoResponseSent: {
      type: Boolean,
      default: false,
    },

    // The admin's manual reply, sent for real via Resend — kept alongside
    // the original message so there's a record of what was said back.
    adminReply: {
      type: String,
      trim: true,
      maxlength: 5000,
      default: null,
    },

    repliedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

messageSchema.index({ createdAt: -1 });

const Message = mongoose.model("Message", messageSchema);
export default Message;
