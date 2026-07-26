const locationService = require("../services/locationService");

exports.search = async (req, res) => res.json({
  locations: await locationService.searchLocations(req.query.q),
});
