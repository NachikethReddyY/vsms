const service = require("../services/event/eventMembershipService");

exports.list = async (req, res) => res.json(await service.listMemberships(req.params.eventId, req.user));
exports.eligible = async (req, res) => res.json(await service.listEligibleUsers(req.params.eventId, req.query, req.user));
exports.add = async (req, res) => res.status(201).json(await service.addMembership(req.params.eventId, req.body, req.user, req.context));
exports.remove = async (req, res) => res.json(await service.removeMembership(req.params.eventId, req.params.membershipId, req.body, req.user, req.context));
exports.addRole = async (req, res) => res.status(201).json(await service.addRole(req.params.eventId, req.params.membershipId, req.body.role, req.user, req.context));
exports.removeRole = async (req, res) => res.json(await service.removeRole(req.params.eventId, req.params.membershipId, req.params.role, req.user, req.context));
