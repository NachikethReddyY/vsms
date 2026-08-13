# VSMS Trust Boundary

```mermaid
flowchart TB

    subgraph CLIENT["Client Trust Zone"]
        ADMIN["Administrator Browser"]
        STAFF["Screening Tablet"]
        OFFLINE["Offline Storage"]
        QR["Participant QR"]
    end

    subgraph API["VSMS Application Trust Zone"]
        SECURITY["Security Middleware"]
        AUTH["Authentication"]
        RBAC["RBAC"]
        VALIDATION["Input Validation"]
        SERVICES["Application Services"]
        AUDIT["Audit Logging"]
    end

    subgraph DATA["Protected Data Zone"]
        DB[("PostgreSQL")]
        BACKUP[("Backup Storage")]
    end

    ADMIN -->|"HTTPS"| SECURITY
    STAFF -->|"HTTPS"| SECURITY
    QR -->|"QR Token"| SECURITY
    OFFLINE -->|"Synchronisation"| SECURITY

    SECURITY --> AUTH
    AUTH --> RBAC
    RBAC --> VALIDATION
    VALIDATION --> SERVICES

    SERVICES --> DB
    SERVICES --> AUDIT
    AUDIT --> DB
    SERVICES --> BACKUP
 ```