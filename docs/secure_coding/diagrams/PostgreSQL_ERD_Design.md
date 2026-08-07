The PostgreSQL database design was developed to support the Visual Screening Management System (VSMS) requirements. The database structure focuses on maintaining data integrity, enforcing relationships between entities, and supporting secure and efficient data operations.

The design incorporates:

- **Relational database principles** to ensure structured data storage.
- **Primary and foreign key constraints** to maintain referential integrity.
- **Indexes** to improve query performance for frequently accessed records.
- **Stored procedures and functions** for handling complex database-level operations.
- **Triggers** for automated data management tasks such as timestamp updates and audit logging.


### PostgreSQL Entity Relationship Design

The following diagram illustrates the PostgreSQL database schema, including the relationships between core entities such as participants, events, registrations, screening results, QR passes, queue management, and audit records.

<!-- Insert PostgreSQL Database Design Image Here -->

<img width="4378" height="2826" alt="Untitled" src="https://github.com/user-attachments/assets/90f2e0b1-5761-40f2-9ed3-44072a14a168" />

*Figure 1: PostgreSQL Database Design and Entity Relationships*
