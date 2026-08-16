const assert = require("node:assert/strict");
const { readdirSync, readFileSync } = require("node:fs");
const { join } = require("node:path");
const test = require("node:test");

const root = join(__dirname, "../..");
const catalogues = join(root, "backend/Stored_Procedures");

test("stored-procedure catalogues cannot become executable migration copies", () => {
  for (const name of readdirSync(catalogues).filter((file) => file.endsWith(".sql"))) {
    const sql = readFileSync(join(catalogues, name), "utf8");
    assert.match(sql, /(?:documentation only|catalog, not a second copy)/i, name);
    assert.doesNotMatch(sql, /^\s*CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|PROCEDURE)/im, name);
  }
});
