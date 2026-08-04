const sesProviderEventService = require("../services/sesProviderEventService");

exports.ingestSesEvent = async (req, res) => {
  const result = await sesProviderEventService.ingestSesProviderEvent(
    req.body,
    { headerType: req.get("x-amz-sns-message-type") || null },
  );
  res.status(202).json(result);
};
