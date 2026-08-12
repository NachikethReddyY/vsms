const dashboardService = require("../services/dashboard/dashboardService");

async function getOverview(req, res) {
    const data = await dashboardService.getOverview();

    res.status(200).json({
        success: true,
        data,
    });
}

async function getDailySummary(req, res) {
    const data = await dashboardService.getDailySummary();

    res.status(200).json({
        success: true,
        data,
    });
}

async function getSyncStatus(req, res) {
    const data = await dashboardService.getSyncStatus();

    res.status(200).json({
        success: true,
        data,
    });
}

module.exports = {
    getOverview,
    getDailySummary,
    getSyncStatus,
};