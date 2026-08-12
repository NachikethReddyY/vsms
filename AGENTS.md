# VSMS
VSMS is a secure, offline-capable system for replacing paper-based workflows at community vision-screening events. It manages participant registration, QR hand-offs, station queues, screening results, clinical review, referrals, and event reporting.
Role-based staff use a React dashboard backed by an Express API and PostgreSQL, with encrypted offline capture and safe synchronization.

# What makes VSMS special?
VSMS is a project for the community. And it is important to take into consideration about security aspects before we delve into implementing anything. We are dealing with important data such as NRIC numbers, which can be critical when leaked. Here's a brief of things that we can never compromise on.

1. security. Every endpoint has to be secure, validated, and if you it has to have a role-based access control.
2. performance without compromise. Lots of apps have bad tech decisions and slop. We have not and we are proud of the performance of VSMS. We regularly audit for performance regressions often by testing the application over and over again to make sure that everything runs smoothly.

# A note from Nachiketh
I like ambitious ideas, simple systems, and software that feels obvious. Do not preserve complexity just because it already exists. Do not introduce machinery because it looks architecturally impressive. Understand the real constraint, then fight for the smallest model that makes the correct behavior unsurprising.

Channel both "measure twice, cut once" and "yagni". Fight scope creep. Try to honor the dev's intent in both a minimal and realistic fashion.

The rest of this document is meant to help you navigate the codebase and make changes effectively. Think of these instructions less as "hard rules", more as "good defaults". The developer's preferences should be able to override anything here.

# A small glossary
We need to be on the same page with terminology. When communicating, use this language:
- you means the agent reading this file and changing VSMS.
- we, and us mean Nachiketh, Keefe, Mike and Sitt who are building VSMS. These are who you are talking to now.
- Staff means the people who are the manpower for different events. They usually have multiple Rules when it comes to this project. such as Screener, Registeration and Support
- When I refer to doctors, it means reviewers. They are the ones who confirm every medical report. They are basically the final stage in the event journey. They're the ones who verify whether everyone is okay and will trigger any issues if required.
- event managers who are responsible for a specific event. They do not have full admin rights but they have full admin rights for that event they can manage they can do the screening and basically they are in charge of everything and have full permissions to that specific event. They can assign manpower to a specific event by pooling in all of the staff that are available.
- administrators who have full access to the entire system and they can customize and do whatever things they want in the system. It belongs to them. They own everything over here. Most of the higher end functions run through them for example deletion of events or downloading of data usually will go through these administrators
- participant
- Client refers to the teachers who are grading the assignment.

# Verifing
To check if your work is correct and it passes the CI check before pushing it to GitHub, run those CIs in a GitHub container and see if everything passes. If something doesn't work, fix them, retest again, create a comment and then open up a PR. Use the `file-pr` skill in the `.agents` directory. If you were to create any sort of test cases, you put them inside a `.vsms` directory to collate all the tests we have.
If you have access to a web browser, use it and check if everything is complete. If there is any auth related layers, do reach out to the user to complete the auth for you so you can validate what work is done or what is the current progress of any given task. Always sign your work by adding a blurb at the bottom of any comment or PR and state from which harness this was created so that we can identify AI generated work and actual human generated code.

# Pull Requests and Commits
- Never make a PR unless the developer specifically asks you to do so.
- Conventional commit titles, plain language eg, fix(web): new threads no longer spike CPU.
- Body: the problem in a sentence or two, then how you fixed it. End with the model and harness that did the work.
- UI changes need before/after images.
- One concern per PR. If the description says "also", split it.
- When babysitting: poll checks and comments newer than the last push, verify each bot finding against the source, fix real ones, dismiss false - positives with a written reason. Stay quiet when nothing is new. Stop when the bots are green on the latest commit.
- If you are given any work to do, always do the work in a new branch unless specified to do the work in the main branch.
- Always break up what the user wants to complete into tasks and once each part of the task is complete, for example, ta if you have nine tasks if the first one is complete create a commit for the first one then commit the second commit third fourth fifth sixth until how many tasks you have and then if the developer asks create a PR.

# How it works
To summarize the workflow:
1. **Account Creation:** The administrator creates a staff account.
2. **Onboarding:** The staff member receives an email containing a temporary password.
3. **Authentication:** They log in through Cognito, update their password, and complete Multi-Factor Authentication (MFA) to access the system.
4. **Role-Based Access:**
   - **Staff:** Can only view events they are assigned to.
   - **Event Managers:** Can view assigned events and are granted full management of specific events by the administrator.
5. **Event Setup:** Events are created in a draft phase by default. Before an event can be published, it must have allocated stations and manpower.
6. **Participant Registration:** A registration officer registers the participant and collects their details.
7. **Queue Management:** The registration officer assigns a virtual queue number and scans the participant's QR code. The backend system calculates the expected flow and generates an optimal path. Screeners and support staff can reassign participants to different stations to balance crowd levels.
8. **Review and Results:** Doctors or reviewers access the test results, sign off on them, and close the case. This allows the participant to leave or triggers a referral cycle.
9. **Notifications:** If referred, the participant receives an email with a password-protected PDF of their results to take to the referral site.

# Taste
- Complexity belongs at the adapter boundary. Orchestration stays pure, UI stays dumb.
- Inferred types over annotations. any is the enemy.
- Comments describe how a thing is used, and move when the code moves. To be used mostly to describe functions, not to annotate every line of behavior.
- If a rule here fights the task in front of you, say so loudly and get a human sign-off before breaking it.
- If the user asks you to polish anything use the `apple-design` skill in the repo's `.agents` folder.
- If you're running a long running task or you're thinking a bit too deeply, keep the user in the loop to make him understand why it is taking that long to do that task. This allows them to plan ahead for future prompts and guidance for the model.


# Repository instructions
Use `pnpm` only. Never run `npm` or `yarn`, and never generate `package-lock.json` or `yarn.lock`; each package's `pnpm-lock.yaml` is authoritative.

# Additional Tips
We have installed Graphify inside this repository that will help us to index the entire project so you can use the Graphify tool to query or to search through the project instead of manually searching through each and every file.
If you have any thing you want to remember, add it to the `CONTEXT.md` and refer to it whenever needed.
