import Message from "./contact.model.js";
import Settings from "../settings/settings.model.js";
import { sendContactAcknowledgmentEmail, sendContactReplyEmail } from "../../utils/email.js";
import logger from "../../utils/logger.js";

export const createMessage = async ({ name, email, subject, message }) => {
  const record = await Message.create({ name, email, subject, message });

  try {
    await sendContactAcknowledgmentEmail(email, name);

    record.autoResponseSent = true;
    await record.save();
  } catch (error) {
    // The message is already saved either way — don't fail the visitor's
    // submission just because the acknowledgment email didn't go out.
    logger.error(
      { err: error },
      "Failed to send contact acknowledgment email",
    );
  }

  return record;
};

export const getMessages = async () => {
  return Message.find({}).sort({ createdAt: -1 });
};

export const markMessageRead = async (id) => {
  const message = await Message.findByIdAndUpdate(
    id,
    { $set: { isRead: true } },
    { new: true },
  );

  if (!message) {
    throw new Error("Message not found");
  }

  return message;
};

export const deleteMessage = async (id) => {
  const message = await Message.findByIdAndDelete(id);

  if (!message) {
    throw new Error("Message not found");
  }

  return message;
};

export const replyToMessage = async (id, replyMessage) => {
  const original = await Message.findById(id);

  if (!original) {
    throw new Error("Message not found");
  }

  // So that if the visitor hits "reply" in their own email client, it
  // lands in the actual owner's inbox, not the Resend sender address.
  const settings = await Settings.findOne({}).select("contactEmail").lean();

  await sendContactReplyEmail({
    toEmail: original.email,
    toName: original.name,
    subject: `Re: ${original.subject || "your message"}`,
    replyMessage,
    originalMessage: original.message,
    replyToEmail: settings?.contactEmail || undefined,
  });

  original.adminReply = replyMessage;
  original.repliedAt = new Date();
  original.isRead = true;

  await original.save();

  return original;
};
