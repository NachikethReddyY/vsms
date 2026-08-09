const locationService = require("../services/event/locationService");

exports.search = async (req, res) => res.json({
  locations: await locationService.searchLocations(req.query.q),
});
