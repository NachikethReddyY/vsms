# A04 – Threat Modelling

## 1. Introduction

Threat modelling is a proactive security analysis technique used to identify potential threats, vulnerabilities, and attack vectors during the system design phase. By analysing how attackers may compromise the system, appropriate security controls can be incorporated early into development to minimise security risks.

For the Optix (Visual Screening Management System), the **STRIDE** threat modelling methodology was adopted to systematically identify potential security threats and evaluate the mitigation measures implemented throughout the application.

---

# 2. Threat Model Diagram

> **Insert Threat Model Diagram Here**

![Threat Model](image.png)

Figure 1 illustrates the high-level architecture of the Optix system together with the primary trust boundaries between the client, backend server, and database.

---

# 3. System Assets

The following assets were identified as requiring protection throughout the application:

- User accounts
- Authentication credentials
- JWT access tokens
- Participant personal information
- Screening records
- Event information
- QR Code registration tokens
- PostgreSQL database
- Audit logs

---

# 4. Trust Boundaries

The application contains several trust boundaries where data transitions between different levels of trust.

| Trust Boundary                        | Description                                                                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------ |
| User → React Frontend                 | Users submit credentials and application requests through the web interface.               |
| React Frontend → Express Backend      | API requests are transmitted over HTTPS using JWT authentication.                          |
| Express Backend → PostgreSQL Database | The backend communicates with the database through Prisma ORM using parameterised queries. |

Each trust boundary represents a potential attack surface that requires appropriate authentication, validation, and security controls.

---

# 5. STRIDE Threat Analysis

## ① Spoofing

**Location:** User Login → React Frontend

### Threat

An attacker attempts to impersonate a legitimate user by using stolen, leaked, or guessed credentials to gain unauthorised access to the system.

### Potential Impact

- Unauthorised access to participant records.
- Exposure of confidential screening information.
- Compromise of user accounts.

### Mitigation

- JWT-based authentication.
- Passwords securely hashed using bcrypt.
- Strong password requirements enforced through Zod validation.
- Authentication performed on the server before issuing access tokens.

---

## ② Tampering

**Location:** React Frontend ↔ Express Backend

### Threat

An attacker intercepts or modifies HTTP requests before they are processed by the backend.

### Potential Impact

- Modification of participant information.
- Corruption of screening records.
- Manipulation of event registration data.

### Mitigation

- HTTPS communication.
- Server-side validation using Zod.
- Prisma ORM parameterised queries.
- Role-Based Access Control (RBAC).
- Server-side validation performed before database updates.

---

## ③ Repudiation

**Location:** Express Backend

### Threat

A legitimate user performs sensitive operations but later denies carrying out those actions.

### Potential Impact

- Reduced accountability.
- Difficulty investigating security incidents.
- Challenges during audit investigations.

### Mitigation

- Winston audit logging.
- Morgan HTTP request logging.
- Timestamped log entries.
- Server-side logging of significant operations.

---

## ④ Information Disclosure

**Location:** PostgreSQL Database

### Threat

Sensitive information is disclosed through insecure API responses, unauthorised access, or accidental exposure.

### Potential Impact

- Leakage of participant personal information.
- Exposure of authentication credentials.
- Loss of confidentiality.

### Mitigation

- Passwords stored only as bcrypt hashes.
- JWT authentication required for protected endpoints.
- Sensitive fields excluded from API responses.
- Helmet security headers.
- Environment variables used to protect sensitive configuration.

---

## ⑤ Denial of Service (DoS)

**Location:** Express Backend

### Threat

An attacker attempts to overwhelm the server using excessively large or malformed requests.

### Potential Impact

- Reduced system availability.
- Increased server resource consumption.
- Temporary service disruption.

### Mitigation

- Express request payload limit (100 KB).
- Zod input validation.
- Global exception handling.
- Request logging for abnormal activity.

---

## ⑥ Elevation of Privilege

**Location:** Protected API Routes

### Threat

A normal staff member attempts to perform administrator-only operations by manipulating requests or bypassing client-side restrictions.

### Potential Impact

- Unauthorised administrative actions.
- Modification or deletion of protected data.
- Compromise of application integrity.

### Mitigation

- JWT verification middleware.
- Role-Based Access Control (RBAC).
- Server-side permission checks.
- Protected API endpoints.

---

# 6. Security Controls Implemented

The Optix system incorporates multiple security controls to reduce the likelihood and impact of identified threats.

| Security Control                 | Purpose                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------ |
| JWT Authentication               | Verifies user identity before protected resources can be accessed.             |
| bcrypt Password Hashing          | Prevents plaintext password storage.                                           |
| Role-Based Access Control (RBAC) | Restricts system functionality based on user roles.                            |
| Zod Validation                   | Validates all incoming requests on the server.                                 |
| Prisma ORM                       | Uses parameterised queries to reduce SQL Injection risks.                      |
| Helmet                           | Applies secure HTTP response headers.                                          |
| Winston Logging                  | Records audit and application events.                                          |
| Morgan Logging                   | Records incoming HTTP requests for monitoring purposes.                        |
| Environment Variables            | Protects sensitive configuration such as database credentials and JWT secrets. |
| Request Payload Limits           | Reduces the risk of Denial of Service attacks.                                 |

---

# 7. Risk Assessment

| Threat                   | Risk Level | Existing Mitigation                                             |
| ------------------------ | ---------- | --------------------------------------------------------------- |
| ① Spoofing               | High       | JWT Authentication, bcrypt password hashing                     |
| ② Tampering              | High       | HTTPS, Zod validation, Prisma ORM, RBAC                         |
| ③ Repudiation            | Medium     | Winston logging, Morgan logging                                 |
| ④ Information Disclosure | High       | Authentication, Password Hashing, Helmet, Environment Variables |
| ⑤ Denial of Service      | Medium     | Payload size limits, Input validation, Error handling           |
| ⑥ Elevation of Privilege | High       | RBAC, JWT verification, Server-side permission checks           |

---

# 8. Residual Risks

Although the implemented controls significantly improve the application's security posture, several residual risks remain.

Potential future improvements include:

- Multi-Factor Authentication (MFA)
- Refresh Token Rotation
- Rate Limiting on authentication endpoints
- Automatic account lockout after repeated failed login attempts
- Continuous dependency scanning using GitHub Dependabot
- Periodic penetration testing
- Automated security testing within the CI/CD pipeline

---

# 9. Conclusion

The STRIDE threat modelling exercise identified the major security risks affecting the Optix system and evaluated the mitigation strategies implemented during development. Authentication, authorisation, input validation, secure password storage, audit logging, and secure database access collectively provide multiple layers of defence against common attacks. By incorporating these security controls throughout the system architecture, Optix reduces the likelihood of successful attacks while maintaining the confidentiality, integrity, and availability of participant information.
