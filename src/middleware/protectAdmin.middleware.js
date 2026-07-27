import protect from "./auth.middleware.js";
import requireAdmin from "./authorize.middleware.js";

/*
  Combined [protect, requireAdmin] middleware pair for routes that only the
  admin should ever reach. Express flattens an array passed as a single
  route handler argument, so this can be dropped in wherever `protect`
  used to gate an admin-only route.
*/
const protectAdmin = [protect, requireAdmin];

export default protectAdmin;
