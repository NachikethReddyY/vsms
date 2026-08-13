# Week 0 – Planning & Requirements

## Individual Progress

| Member | Progress | Issues Faced | Next Week |
|---------|----------|--------------|-----------|
| **Keefe Chen Lin Li** | Completed the initial Entity Relationship Diagram (ERD) by identifying entities, attributes, primary keys, foreign keys, and relationships. Discussed the database requirements with the team and selected PostgreSQL with Prisma ORM for implementation. | Some entity relationships required further discussion to ensure they supported the system requirements without introducing redundancy. | Finalise the ERD, validate the database design with the team, and begin implementing the Prisma schema. |
| Member 1 | Discussed authentication and authorisation requirements. | Authentication workflow and user roles were still being refined. | Design the authentication module and define user roles. |
| Member 3 | Participated in backend planning and API discussions. | API endpoints had not been finalised. | Prepare the backend project structure and REST API routes. |
| Member 4 | Started planning the user interface and application flow. | Waiting for backend requirements before implementing the frontend. | Produce wireframes and prepare the frontend layout. |

## Reflection

### What Went Well?

- Successfully gathered the initial project requirements and allocated responsibilities among team members.
- Completed the first version of the ERD, providing a strong foundation for database implementation.
- Established the overall technology stack and project architecture.

### Challenges

- Refining entity relationships to support future features while avoiding redundant data.
- Finalising functional requirements as the project scope evolved.

### Improvements

- Conduct more frequent design review sessions before implementation.
- Finalise system requirements earlier to minimise future design changes.

---

# Week 1 – Database Design

## Objectives

- Design and implement the database using PostgreSQL and Prisma ORM.
- Establish relationships and database constraints.
- Prepare the database for backend integration.

## Database

- [x] Prisma Schema
- [x] PostgreSQL Setup
- [x] Initial Migration
- [x] Seed Data
- [x] Primary Keys
- [x] Foreign Keys
- [x] Relationships
- [x] Constraints
- [x] Indexes

## Secure Coding

- [x] Authentication Design
- [x] Role Design
- [x] Input Validation Planning
- [x] Password Hashing Planning
- [x] JWT Planning

## Individual Progress

| Member | Progress | Issues Faced | Next Week |
|---------|----------|--------------|-----------|
| **Keefe Chen Lin Li** | Designed the Prisma schema, implemented PostgreSQL migrations, created entity relationships, constraints, indexes, and seed data. Updated the ERD to reflect implementation changes. | Some foreign key relationships and migration errors required additional refinement during development. | Support backend integration, optimise database queries, and validate CRUD operations. |
|Nachikth | Planned authentication database structure and user roles. | Integration with database models was still pending. | Begin implementing authentication APIs. |
| Mike | Started backend project setup and API routing. | Depended on completion of the database schema. | Connect backend APIs to Prisma ORM. |
| Member 4 | Finalised frontend wireframes and navigation. | Backend APIs were not yet available for integration. | Prepare frontend components for API integration. |

---

# Week 2 – Backend Development

## Objectives

- Develop secure backend APIs.
- Connect Express APIs with Prisma ORM.
- Implement authentication, validation, and logging.

## APIs

- [x] Authentication
- [x] Participants
- [x] Events
- [x] QR Registration
- [ ] Screening
- [ ] Referrals

## Secure Coding

- [x] JWT Authentication
- [x] Authorization
- [x] SQL Injection Prevention
- [x] Input Validation (Zod)
- [x] Error Handling
- [x] Logging

## Database

- [x] CRUD Operations
- [ ] Transactions
- [ ] Stored Procedures
- [x] Query Optimisation

## Testing

- [x] Postman Testing
- [ ] Unit Testing

## Individual Progress

| Member | Progress | Issues Faced | Next Week |
|---------|----------|--------------|-----------|
| **Keefe Chen Lin Li** | Assisted in integrating Prisma with the backend, tested participant registration, event registration, and QR code generation. Supported debugging of schema and database-related issues during API development. | Encountered migration conflicts, merge conflicts, and route integration issues while collaborating across branches. | Complete remaining database functionality, optimise queries, and support screening and referral modules. |
| Member 1 | Implemented JWT authentication and password hashing. | Token refresh and role validation required additional testing. | Improve authentication and authorisation logic. |
| Member 3 | Developed REST APIs for participants, events, and QR code functionality. | Validation and routing conflicts occurred during implementation. | Complete remaining APIs and improve error handling. |
| Member 4 | Started integrating frontend pages with backend APIs. | Frequent backend changes required frontend updates. | Continue API integration and frontend testing. |

---

# Week 3 – Frontend Integration

## Objectives

- Integrate frontend components with backend APIs.
- Complete user interface development.
- Perform functional testing.

## Frontend

- [x] Login
- [x] Participant Registration
- [x] QR Registration
- [x] Event Management
- [ ] Dashboard
- [ ] Screening
- [ ] Reports

## Integration

- [x] API Integration
- [x] Error Handling
- [x] Loading States
- [x] Authentication

## Testing

- [x] Functional Testing
- [ ] Integration Testing
- [ ] Performance Testing

## Individual Progress

| Member | Progress | Issues Faced | Next Week |
|---------|----------|--------------|-----------|
| **Keefe Chen Lin Li** | Assisted in frontend-backend integration by testing APIs, debugging Prisma queries, resolving validation issues, and supporting QR code and participant registration features. | Merge conflicts and inconsistent API responses caused delays during integration. | Complete remaining frontend integration, perform end-to-end testing, and improve database performance where necessary. |
| Member 1 | Integrated authentication with the frontend. | Session handling required further refinement. | Complete authentication testing. |
| Member 3 | Continued backend development and bug fixes. | Backend modifications required additional frontend changes. | Finalise remaining backend modules. |
| Member 4 | Developed login, registration, and event management pages. | Some features depended on incomplete backend APIs. | Complete dashboard and reporting pages. |

---

# Week 4 – Testing & Deployment

## Objectives

- Perform final testing.
- Review security implementation.
- Deploy the application.
- Complete documentation.

## Security

- [ ] OWASP Top 10 Review
- [ ] Authentication Testing
- [ ] Authorization Testing
- [ ] Audit Logging
- [ ] Logging & Monitoring

## Database

- [ ] Performance Testing
- [ ] Index Verification
- [ ] Query Optimisation Review

## Cloud

- [ ] Environment Variables
- [ ] PostgreSQL Deployment
- [ ] HTTPS Configuration
- [ ] Production Testing

## Documentation

- [ ] User Guide
- [ ] Technical Documentation
- [ ] API Documentation
- [ ] Final Presentation

## Individual Progress

| Member | Progress | Issues Faced | Next Week |
|---------|----------|--------------|-----------|
| **Keefe Chen Lin Li** | Preparing the database for deployment by reviewing the Prisma schema, validating database integrity, and documenting implementation decisions. Supporting final debugging and integration across the project. | Deployment configuration and full integration testing are still ongoing. | Complete performance testing, finalise documentation, assist with deployment, and support final presentation preparation. |
| Member 1 | Finalising authentication and security testing. | Security review is still ongoing. | Complete OWASP validation and audit logging. |
| Member 3 | Completing remaining backend features and API testing. | Minor bugs identified during integration testing. | Resolve outstanding issues before deployment. |
| Member 4 | Finalising frontend pages and presentation materials. | Minor UI improvements remain. | Complete testing, deployment, and presentation preparation. |

## Pull Requests

| PR | Description |
|------|-------------|
| | |
