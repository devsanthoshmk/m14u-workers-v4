# Android artifact workflow

- Build with the checked-in pnpm lockfile and the same `android:build` command used locally so the APK includes freshly built web assets.
- **Release:** Branch builds upload a debug artifact. Stable tags publish only the verified release-signed APK. Read [the release procedure](../docs/CAPACITOR.md#github-releases) before changing signing, versioning, or publication.
