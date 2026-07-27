const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== "admin") {
    return res.status(403).json({
      success: false,
      message: "Admin access required",
      yourEmail: req.user?.email || null,
      yourRole: req.user?.role || null,
    });
  }

  next();
};

export default requireAdmin;
