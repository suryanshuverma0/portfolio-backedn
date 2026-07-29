import Message from "./contact.model.js";
import { sendContactAcknowledgmentEmail } from "../../utils/email.js";
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
