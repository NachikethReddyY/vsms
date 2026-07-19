const validate = (schema) => {
    return (req, res, next) => {
        try {

            // Validate request body using Zod schema
            schema.parse(req.body);

            // Continue to controller if validation passes
            next();

        } catch (error) {

            // Handle Zod validation errors
            if (error.name === "ZodError") {
                return res.status(400).json({
                    success: false,
                    message: "Validation failed",
                    errors: error.errors.map((err) => ({
                        field: err.path.join("."),
                        message: err.message
                    }))
                });
            }

            // Handle unexpected errors
            next(error);
        }
    };
};


module.exports = validate;