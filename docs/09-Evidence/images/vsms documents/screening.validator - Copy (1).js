module.exports = {
  port: process.env.PORT || 3000,
  awsRegion: process.env.AWS_REGION || "ap-southeast-1",
  tableName: process.env.TABLE_NAME || "VisualScreeningTable",
  corsOrigin: process.env.CORS_ORIGIN || "*"
};