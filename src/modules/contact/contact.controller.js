import {
  createMessage,
  getMessages,
  markMessageRead,
  deleteMessage,
  replyToMessage,
} from "./contact.service.js";

export const createMessageController = async (req, res, next) => {
  try {
    await createMessage(req.validatedData);

    res.status(201).json({
      success: true,
      message: "Message sent — thanks for reaching out!",
    });
  } catch (error) {
    next(error);
  }
};

export const getMessagesController = async (req, res, next) => {
  try {
    const messages = await getMessages();

    res.status(200).json({
      success: true,
      data: messages,
    });
  } catch (error) {
    next(error);
  }
};

export const markMessageReadController = async (req, res, next) => {
  try {
    const message = await markMessageRead(req.params.id);

    res.status(200).json({
      success: true,
      message: "Marked as read",
      data: message,
    });
  } catch (error) {
    next(error);
  }
};

export const deleteMessageController = async (req, res, next) => {
  try {
    await deleteMessage(req.params.id);

    res.status(200).json({
      success: true,
      message: "Message deleted",
    });
  } catch (error) {
    next(error);
  }
};

export const replyToMessageController = async (req, res, next) => {
  try {
    const { message } = req.validatedData;

    const updated = await replyToMessage(req.params.id, message);

    res.status(200).json({
      success: true,
      message: "Reply sent",
      data: updated,
    });
  } catch (error) {
    next(error);
  }
};
