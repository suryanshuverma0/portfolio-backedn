
const validate = (schema) => {
  return async (req, res, next) => {
    try {
      const validatedData =
        await schema.parseAsync(req.body);

      req.validatedData = validatedData;

      next();
    } catch (error) {
      return res.status(400).json({
        success: false,

        message: "Validation failed",

        errors: error.errors?.map((err) => ({
          field: err.path.join("."),

          message: err.message,
           errors: error.issues,
        })),
      });
    }
  };
};

export default validate;
