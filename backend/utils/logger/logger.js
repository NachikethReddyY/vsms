const winston = require("winston");
const WinstonCloudWatch = require("winston-cloudwatch");

const transports = [
    new winston.transports.Console(),

    new winston.transports.File({
        filename: "logs/error.log",
        level: "error",
    }),

    new winston.transports.File({
        filename: "logs/combined.log",
    }),
];

// Only enable CloudWatch if configured
if (
    process.env.AWS_REGION &&
    process.env.CLOUDWATCH_LOG_GROUP &&
    process.env.CLOUDWATCH_LOG_STREAM
) {
    transports.push(
        new WinstonCloudWatch({
            logGroupName: process.env.CLOUDWATCH_LOG_GROUP,
            logStreamName: process.env.CLOUDWATCH_LOG_STREAM,
            awsRegion: process.env.AWS_REGION,
            jsonMessage: true,
        })
    );
}

const logger = winston.createLogger({
    level: "info",

    format: winston.format.combine(
        winston.format.timestamp(),

        winston.format.errors({
            stack: true,
        }),

        winston.format.printf(({ timestamp, level, message, stack }) => {
            return `${timestamp} [${level.toUpperCase()}] ${stack || message}`;
        })
    ),

    transports,
});

module.exports = logger;