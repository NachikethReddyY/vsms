# Final submission assembly

The repository can produce the source ZIP now. The outer DBSP/Secure Coding
package cannot be truthfully finalized until the submitting student supplies
the BrightSpace-owned files and authorized database export.

## Required human inputs

1. Exact student identifier and filename-safe name stem.
2. Completed individual DBSP report PDF using the BrightSpace template.
3. Signed official Academic Integrity declaration DOCX.
4. Authorized PostgreSQL **plain SQL** backup from the submission environment.
5. Final Lucidchart ERD iterations and editable link for insertion in the
   individual database report.
6. Current AWS/Cognito acceptance screenshots after the live replay.

## Assembly command

Run from a clean committed worktree:

```bash
pnpm package:final-submission -- \
  --student-id YOUR_STUDENT_ID \
  --name YOUR_FILENAME_NAME \
  --report /absolute/path/YOUR_FILENAME_NAME_Project2Report.pdf \
  --database /absolute/path/vsms.sql \
  --declaration /absolute/path/Academic_Integrity_Declaration.docx
```

The command validates file signatures and archive paths, generates the
secret-free source archive, creates the SQL database ZIP, applies the official
DBSP filenames, adds the ten-page Secure Coding report and verified slide
deck, and writes `.submission/YOUR_STUDENT_ID-YOUR_FILENAME_NAME.zip`.

The script refuses a custom-format database dump because the DBSP brief
specifically requires an SQL backup. The tested custom dump remains recovery
evidence under issue #98; it is not silently substituted for the required
submission file.
