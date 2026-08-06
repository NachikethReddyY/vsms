# Deployment Architecture Documentation
<img width="1412" height="242" alt="DeploymentDiagram drawio (2)" src="https://github.com/user-attachments/assets/5213e7d1-8efd-4aa3-956d-b54249223a5e" />

## Overview
This document outlines the multi-tier secure cloud architecture and edge runtime model for the Visual Screening Management System (VSMS). The design guarantees high availability, secure boundary isolation, and robust offline synchronization capabilities.

## 1. High-Level Topology & Architecture Overview
The system architecture is structured across four logical tiers, establishing a left-to-right secure boundary progression from the client edge to persistent cloud storage.



* **Client Edge (PWA Tier):** Runs locally on field tablets, enabling fully functional offline screening operations. It houses the React Single Page Application (SPA), a local `IndexedDB` browser store, and an `Offline Queue Manager` to handle background synchronization logic.
* **API Gateway & Security Tier:** Acts as the secure perimeter for inbound traffic. It enforces **TLS 1.3 / HTTP** and leverages **AWS WAF** for threat protection alongside **AWS Cognito** for identity verification, JWT issuing, and Multi-Factor Authentication (MFA).
* **Compute Tier:** Processes backend business logic via containerized application services on **AWS ECS (Fargate Express API)** and scale-to-zero serverless functions on **AWS Lambda**.
* **Data & Secrets Tier:** Provides durable state management and secure configuration. Database persistence is handled via **DynamoDB / PostgreSQL**, asset hosting via **Amazon S3**, and environment variable or credential injection via **AWS Secrets Manager**.

---

## 2. Infrastructure & Deployment Implementation

| Layer | Component | Hosting Target / Service | Security & Operational Role |
| :--- | :--- | :--- | :--- |
| **Edge** | Field PWA Client | Amazon S3 / CloudFront | Static asset caching, offline execution via service workers. |
| **Gateway** | API Routing & Auth | AWS API Gateway & Cognito | Rate limiting, endpoint routing, token validation, and MFA. |
| **Compute** | Core Services | AWS ECS (Fargate) & Lambda | Express API execution, asynchronous background queue workers. |
| **Data** | Persistence & Secrets | RDS / DynamoDB & Secrets Manager | Encrypted data at rest, secure credential and secret retrieval. |

---

## 3. Offline Synchronization & Resiliency Flow
To ensure uninterrupted field performance during intermittent or total network loss, the architecture implements a local-first queue synchronization pattern:

1. **Local Capture:** All user entries, screening results, and registration records write directly to the local browser `IndexedDB` storage.
2. **Queue Management:** The `Offline Queue Manager` tracks synchronization states (`PENDING`, `SUCCESS`, `FAILED`) and packages un-synced transactions.
3. **Batch Reconciliation:** When connectivity is restored, requests are securely transmitted to the backend via idempotent batch sync endpoints, avoiding record duplication and automatically updating the operational dashboard.estored, requests are securely transmitted to the backend via idempotent batch sync endpoints, avoiding record duplication and automatically updating the operational dashboard.
