---
title: ST2515 Secure Coding Project Report (CA2)
authors:
  - Nachiketh Reddy Y (A01, A09)
  - Mike Franco Abat (A03)
  - Sitt Naing (A04)
  - Keefe Chen Lin Li (A07, A02)
module: ST2515 Secure Coding
date: June 2026
submission: 29 June 2026
---

# Visual Screening Management System (VSMS) — Secure Coding Project Report

## 1. Executive Summary & Problem Statement
### 1.1 Executive Summary
### 1.2 Problem Statement
### 1.3 Business Requirements

## 2. Requirements Analysis
### 2.1 Functional Requirements
### 2.2 Non-Functional Requirements
### 2.3 Use Case Analysis

## 3. Architecture Design
### 3.1 Enterprise Cloud Architecture Overview
### 3.2 Client (PWA) & Offline Layer Design
### 3.3 Integration & Messaging Layer Architecture

## 4. Database Design (NoSQL)
### 4.1 Relational to NoSQL Single-Table Mapping Matrix
### 4.2 Access Patterns & Global Secondary Indexes (GSIs)
### 4.3 Item Collections & Sample Data Structure

## 5. API Design
### 5.1 Secure Core API Specification Table
### 5.2 Idempotency Processing Flow & Transaction Validation
### 5.3 Standard Error Responses and Status Codes

## 6. Security Design
### 6.1 OWASP Top 10 Mitigation Controls (A01 - A10)
### 6.2 Authentication, Authorization & Session Management (JWT / Cognito)
### 6.3 Data Encryption (At-Rest via KMS & In-Transit via TLS 1.3)
### 6.4 Security Monitoring, Audit Logging & DevSecOps Pipeline

## 7. Implementation
### 7.1 Frontend Architecture & Component Structure
### 7.2 Backend Application Services & Lambda Functions
### 7.3 Offline Synchronization Worker Logic

## 8. Testing Results
### 8.1 Automated Security Scanning (SAST/SCA/Secret Detection)
### 8.2 Functional Validation & Exception Handling Reports
#### 8.2.1 Core Registration Endpoint Validation (`POST /participants`)
The participant registration process was tested to ensure proper request parsing, multi-table database transaction processing, and strict HTTP response security header enforcement.

* **Test Objective:** Verify successful creation of a new participant record along with its associated event registration entry in an ACID-compliant database transaction.
* **Input Payload:** Standard registration payload containing sensitive demographic data (NRIC, contact information) alongside structural foreign keys (`eventId`, `userId`).
* **Observed Result:** `HTTP/1.1 201 Created` returned in 165ms.
<img width="701" height="567" alt="image" src="https://github.com/user-attachments/assets/113cf5e9-91d1-4ccb-8b21-c6382238fb04" />

```json
POST http://localhost:5000/participants
Content-Type: application/json

{
  "nric": "S1234567A",
  "firstName": "John",
  "lastName": "Doe",
  "dateOfBirth": "1990-01-01",
  "gender": "M",
  "contactNumber": "91234567",
  "emergencyContact": "98765432",
  "consentGiven": true,
  "eventId": "01f6b64b-d80d-427e-9d43-...",
  "userId": "5464da13-1d47-45ba-8e10-..."
}
```
### 8.2.2 Security Control & Header Verification
As demonstrated in the response headers of Figure 8.1, the application layer successfully enforces strict defensive headers via HTTP middleware to prevent common web vulnerabilities:

- Strict Content Security Policy (CSP): Restricts script execution and limits connections exclusively to trusted endpoints ('self' and https://api.vsms-screening.org).
- Clickjacking Protection: Configured with X-Frame-Options: SAMEORIGIN and frame-ancestors 'none'.
- Transport & MIME Hardening: Enforces Strict-Transport-Security (HSTS max-age 1 year) and X-Content-Type-Options: nosniff to eliminate protocol downgrade and MIME-sniffing vectors.

### 8.3 Rate Limiting & Concurrency Testing Verification

## 9. Bonus Features
### 9.1 Infrastructure Hardening (AWS S3, Secret Manager & Cognito Integration)
### 9.2 Event-Driven Architecture & Automated QR Capabilities
### 9.3 Responsive Design & Real-Time Operational Dashboard

## 10. Deployment Guide
### 10.1 Environment Configurations & Prerequisites
### 10.2 Database Scripts & Infrastructure-as-Code (IaC) Setup
### 10.3 Application Build & Deployment Automation

## 11. Reflection & Appendices
### 11.1 Group Reflection & Technical Lessons Learned
### 11.2 References
### 11.3 Declaration of Academic Integrity
