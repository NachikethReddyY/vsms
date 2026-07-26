-- Link local staff profiles to Cognito's stable subject identifier.
ALTER TABLE "user" ADD COLUMN "cognito_sub" UUID;

CREATE UNIQUE INDEX "user_cognito_sub_key" ON "user"("cognito_sub");
