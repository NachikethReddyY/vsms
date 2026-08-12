const { Prisma } = require("@prisma/client");
const prisma = require("../../prisma/prismaClient");
const AppError = require("../../errors/AppError");
const logger = require("../../utils/logging/logger/logger");

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

/**
 * Validates and converts input into a valid days integer.
 *
 * @param {number|string} [value]
 * @returns {number}
 */
const parseDays = (value) => {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_DAYS;
  }

  const days = Number(value);

  if (!Number.isInteger(days) || days < 1 || days > MAX_DAYS) {
    throw new AppError(
      400,
      "INVALID_DAYS",
      `days must be an integer between 1 and ${MAX_DAYS}`
    );
  }

  return days;
};

/**
 * Normalizes DB raw count/sum results safely into JS Numbers.
 *
 * @param {string|number|bigint|null} val
 * @returns {number}
 */
const toNumber = (val) => (val ? Number(val) : 0);

/**
 * Returns a daily screening summary from the materialized view.
 *
 * @param {Object} [options]
 * @param {string} [options.eventId]
 * @param {number|string} [options.days]
 * @param {Object} [options.db]
 */
async function getDailyScreeningSummary({
  eventId = null,
  days,
  db = prisma,
} = {}) {
  const numberOfDays = parseDays(days);

  try {
    // Dynamic WHERE clause constructed safely using Prisma.sql
    const eventFilter = eventId
      ? Prisma.sql`AND event_id = ${eventId}`
      : Prisma.empty;

    return await db.$queryRaw`
      SELECT
        screening_date,
        participants_screened,
        total_screenings,
        completed_screenings,
        flagged_screenings,
        referred_screenings
      FROM mv_daily_screening_summary
      WHERE screening_date >= CURRENT_DATE - (${numberOfDays} - 1)::integer
        ${eventFilter}
      ORDER BY screening_date ASC
    `;
  } catch (error) {
    logger.error("dashboard.daily_summary_failed", {
      eventId,
      days: numberOfDays,
      message: error.message,
      code: error.code,
    });

    throw new AppError(
      500,
      "DASHBOARD_SUMMARY_FAILED",
      "Unable to retrieve daily screening summary"
    );
  }
}

/**
 * Returns dashboard KPI values and daily trend aggregations.
 *
 * @param {Object} [options]
 * @param {string} [options.eventId]
 * @param {number|string} [options.days]
 * @param {Object} [options.db]
 */
async function getDashboardSummary({ eventId = null, days, db = prisma } = {}) {
  const periodDays = parseDays(days);
  const rawDailySummary = await getDailyScreeningSummary({
    eventId,
    days: periodDays,
    db,
  });

  // Map & normalize daily metrics
  const daily = rawDailySummary.map((row) => ({
    date:
      row.screening_date instanceof Date
        ? row.screening_date.toISOString().split("T")[0]
        : row.screening_date,
    participantsScreened: toNumber(row.participants_screened),
    totalScreenings: toNumber(row.total_screenings),
    completedScreenings: toNumber(row.completed_screenings),
    flaggedScreenings: toNumber(row.flagged_screenings),
    referredScreenings: toNumber(row.referred_screenings),
  }));

  // Aggregate total KPIs across the period
  const totals = daily.reduce(
    (acc, day) => {
      acc.participantsScreened += day.participantsScreened;
      acc.totalScreenings += day.totalScreenings;
      acc.completedScreenings += day.completedScreenings;
      acc.flaggedScreenings += day.flaggedScreenings;
      acc.referredScreenings += day.referredScreenings;
      return acc;
    },
    {
      participantsScreened: 0,
      totalScreenings: 0,
      completedScreenings: 0,
      flaggedScreenings: 0,
      referredScreenings: 0,
    }
  );

  // Calculate percentage metrics
  const completionRate =
    totals.totalScreenings > 0
      ? Number(((totals.completedScreenings / totals.totalScreenings) * 100).toFixed(2))
      : 0;

  const referralRate =
    totals.participantsScreened > 0
      ? Number(((totals.referredScreenings / totals.participantsScreened) * 100).toFixed(2))
      : 0;

  return {
    periodDays,
    eventId,
    kpis: {
      ...totals,
      completionRate,
      referralRate,
    },
    daily,
  };
}

module.exports = {
  getDailyScreeningSummary,
  getDashboardSummary,
};