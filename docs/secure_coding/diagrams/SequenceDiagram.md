## Sequence Diagram

The sequence diagram illustrates the interaction flow between users, system components, and backend services during the Visual Screening Management System (VSMS) workflow.

The process begins when a Registration Officer registers a participant through the React Progressive Web Application (PWA). The system validates and stores participant information either directly through the backend API when online or temporarily within IndexedDB when operating offline.

During screening, screeners retrieve participant information and record screening outcomes. The system performs validation and threshold checks before storing results. If network connectivity is unavailable, screening data is stored locally and synchronised once connectivity is restored.

After screening completion, reviewers access screening results, acknowledge flagged outcomes, and generate referrals when required. Finally, operational data is aggregated and displayed through the dashboard to provide real-time visibility of event progress, screening completion, and referral statistics.

This sequence demonstrates the VSMS requirements for offline-first operation, secure API communication, reliable synchronisation, role-based access control, and auditability.

<img width="1542" height="3210" alt="Sequence Diagram" src="https://github.com/user-attachments/assets/b5dc9dc9-71f6-46eb-aba1-5743a678e005" />

Diagram
