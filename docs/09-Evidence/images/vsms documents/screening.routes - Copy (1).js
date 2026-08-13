const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, PutCommand, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const config = require("../config");

const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.awsRegion }));

async function saveScreeningItem(item) {
  await ddb.send(new PutCommand({
    TableName: config.tableName,
    Item: item,
    ConditionExpression: "attribute_not_exists(PK) AND attribute_not_exists(SK)"
  }));
  return item;
}

async function getResultsByPatient(patientId) {
  const result = await ddb.send(new QueryCommand({
    TableName: config.tableName,
    KeyConditionExpression: "PK = :pk AND begins_with(SK, :sk)",
    ExpressionAttributeValues: {
      ":pk": `PATIENT#${patientId}`,
      ":sk": "RESULT#"
    },
    ScanIndexForward: false
  }));
  return result.Items || [];
}

module.exports = { saveScreeningItem, getResultsByPatient };