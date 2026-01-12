# Security notes (Earth Engine)

Do NOT paste service account keys into chat, issues, or commit them to git.

If you have already shared a key publicly, treat it as compromised:

1) **Revoke / delete the key** in Google Cloud Console
   - IAM & Admin → Service Accounts → (your account) → Keys → Delete
2) **Create a new key** only when needed
3) Store it locally and set env vars:
   - `GOOGLE_APPLICATION_CREDENTIALS=C:\path\to\key.json`
   - `EE_SERVICE_ACCOUNT=<service-account-email>`

Our scripts support service account auth via these env vars or CLI flags.

Recommended: keep keys outside the repo and use `.gitignore` rules.
