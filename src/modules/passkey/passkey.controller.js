import {
  getRegistrationOptions,
  verifyRegistration,
  getAuthenticationOptions,
  verifyAuthentication,
  listPasskeys,
  renamePasskey,
  deletePasskey,
} from "./passkey.service.js";

/*
  Cookie options duplicated from the password-auth controller on purpose —
  this module stays self-contained (same pattern as ../google-auth).
*/
const accessCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "none",
  maxAge: 15 * 60 * 1000,
};

const refreshCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "none",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

export const registrationOptionsController = async (req, res, next) => {
  try {
    const options = await getRegistrationOptions(req.user);

    res.status(200).json({ success: true, data: options });
  } catch (error) {
    next(error);
  }
};

export const registrationVerifyController = async (req, res, next) => {
  try {
    const { response, name } = req.validatedData;

    const passkey = await verifyRegistration(req.user, response, name);

    res.status(201).json({
      success: true,
      message: "Passkey registered",
      data: passkey,
    });
  } catch (error) {
    next(error);
  }
};

export const authenticationOptionsController = async (req, res, next) => {
  try {
    const options = await getAuthenticationOptions();

    res.status(200).json({ success: true, data: options });
  } catch (error) {
    next(error);
  }
};

export const authenticationVerifyController = async (req, res, next) => {
  try {
    const { response } = req.validatedData;

    const { user, accessToken, refreshToken } = await verifyAuthentication(response);

    res
      .status(200)
      .cookie("accessToken", accessToken, accessCookieOptions)
      .cookie("refreshToken", refreshToken, refreshCookieOptions)
      .json({
        success: true,
        message: "Passkey login successful",
        data: user,
      });
  } catch (error) {
    next(error);
  }
};

export const listPasskeysController = async (req, res, next) => {
  try {
    const passkeys = await listPasskeys(req.user._id);

    res.status(200).json({ success: true, data: passkeys });
  } catch (error) {
    next(error);
  }
};

export const renamePasskeyController = async (req, res, next) => {
  try {
    const { name } = req.validatedData;

    const passkey = await renamePasskey(req.user._id, req.params.id, name);

    res.status(200).json({
      success: true,
      message: "Passkey renamed",
      data: passkey,
    });
  } catch (error) {
    next(error);
  }
};

export const deletePasskeyController = async (req, res, next) => {
  try {
    await deletePasskey(req.user._id, req.params.id);

    res.status(200).json({ success: true, message: "Passkey deleted" });
  } catch (error) {
    next(error);
  }
};
