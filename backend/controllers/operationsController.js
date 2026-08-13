const operationsService = require("../services/operations/operationsService");

exports.getOverview = async (req, res) => {
  const overview = await operationsService.getOverview(req.query, req.user);
  res.set("Cache-Control", "no-store").json(overview);
};
