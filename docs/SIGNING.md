# Signing updates

macOS associates privacy permissions with an application's signing requirement.
Ad-hoc builds use a code hash, which changes between updates. Keeping the same
app name, bundle identifier and installation path does not preserve that identity.

For builds distributed to users, configure a Developer ID Application identity
in the build machine's keychain and keep using that identity:

```sh
BROCCOLI_SIGNING_IDENTITY='Developer ID Application: Your Name (TEAMID)' \
  python3 -B scripts/build.py --distribution
```

The app, native helpers, bundled Python modules, installer and separate uninstaller
use this identity. A missing or invalid configured identity stops the build; it
never silently falls back to ad-hoc signing. The private key stays in the keychain
and must never be committed.

Without this variable, local builds retain ad-hoc signing and may require privacy
permissions again after updates. Switching an existing installation from ad-hoc
to certificate signing may also require one new approval. Permission retention
must be verified on macOS across two signed versions; a signature check alone
does not prove it. Notarization remains a separate release step.

References: [Apple signing requirements](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements),
[Apple code signing guide](https://developer.apple.com/library/archive/technotes/tn2206/).
