# tombstack-upload

Offline crash uploader for native / custom-engine games (a stopgap until the native core,
or for engines other than Unity). At crash time, write the ingestion JSON body to a directory;
on next launch, drain it:

```bash
TOMBSTACK_BASE_URL=https://<host> TOMBSTACK_TOKEN=tmb_… node upload.mjs <crash-dir>
```

- 2xx → uploaded + file deleted · 429/5xx/network → kept for retry · other 4xx → dropped.
- No dependencies; Node 18+. Same offline-first behavior the Unity SDK has built in.
