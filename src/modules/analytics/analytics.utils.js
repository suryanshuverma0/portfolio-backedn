import { UAParser } from "ua-parser-js";
import geoip from "geoip-lite";

// Derives device/browser/os/country from the request itself — never from
// client-supplied fields, since those can't be trusted for anything used
// in aggregate reporting.
export const getRequestMeta = (req) => {
  const ua = new UAParser(req.headers["user-agent"] || "").getResult();

  const deviceType = ua.device.type; // "mobile" | "tablet" | undefined
  const device =
    deviceType === "mobile" || deviceType === "tablet" ? deviceType : "desktop";

  const geo = geoip.lookup(req.ip);

  return {
    device,
    browser: ua.browser.name || "Other",
    os: ua.os.name || "Other",
    country: geo?.country || undefined,
  };
};
