const AppError = require("../errors/AppError");

const validateExternalUrl = (req, res, next) => {
  const targetUrl = req.body.targetUrl || req.query.url;
  
  if (!targetUrl) {
    return next(); // Skip if no URL is provided in this request
  }

  try {
    const parsedUrl = new URL(targetUrl);
    
    // Enforce protocol security (only allow HTTPS for external links)
    if (parsedUrl.protocol !== "https:") {
      return next(new AppError(400, "INVALID_URL", "Only secure HTTPS URLs are permitted."));
    }

    // Check against an allow list of trusted domains (prevents SSRF attacks)
    const allowedDomains = ["trusted-partner.com", "api.github.com"];
    if (!allowedDomains.includes(parsedUrl.hostname)) {
      return next(new AppError(403, "URL_NOT_ALLOWED", "This domain is not on the allowed list."));
    }

    next();
  } catch (error) {
    return next(new AppError(400, "INVALID_URL", "Malformed or invalid URL provided."));
  }
};

module.exports = { validateExternalUrl };