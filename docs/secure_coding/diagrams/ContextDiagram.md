# VSMS system context

```mermaid
flowchart LR
  Staff[Event staff and administrators] --> Client[React browser client]
  Client --> API[VSMS Express API]
  API --> DB[(PostgreSQL)]
  API -. when configured .-> Cognito[Amazon Cognito]
  API -. when configured .-> OneMap[OneMap]
  API -. when configured .-> Mail[Configured mail/provider services]
```

The repository proves the application integrations and configuration seams above. It does not prove a deployed AWS account, API Gateway, ECS/Lambda, WAF, S3/CloudFront, DynamoDB, Secrets Manager, or CloudWatch deployment; those are not presented as current infrastructure.
