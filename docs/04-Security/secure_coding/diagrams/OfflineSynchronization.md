# VSMS offline synchronization

```mermaid
stateDiagram-v2
    [*] --> NotDownloaded
    NotDownloaded --> Ready: online pull / assigned station pack
    Ready --> Pending: save supported station result offline
    Pending --> Syncing: reconnect or Sync action
    Syncing --> Applied: server applies idempotent action
    Syncing --> Conflict: server returns safe conflict
    Syncing --> Pending: network failure / retry later
    Conflict --> Pending: staff fixes cause and retries
    Ready --> Expired: event or assignment expiry
    Pending --> Expired: offline access expiry
    Expired --> NotDownloaded: purge local records
    Ready --> Cleared: logout or user change
    Pending --> Cleared: logout or user change
    Cleared --> NotDownloaded
```

Current support covers assigned visual-acuity, refraction, colour-vision and
eye-health station flows. The service worker caches the app shell; clinical
packs and pending mutations remain separately encrypted in IndexedDB and are
bound to the signed-in owner and event.
