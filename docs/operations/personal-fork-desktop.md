# Personal fork desktop workflow

This fork replaces the installed Linux desktop app and keeps its existing runtime data in
`~/.t3/userdata`. Development runs use separate data. Deployment is a local AppImage
replacement; upstream releases and the repository's release workflow do not install this fork.

## Develop a change

Start each change from the fork's `main` on its own branch. Keep `main` deployable.

```sh
git switch main
git switch -c feature/<topic>
vp i --frozen-lockfile
vp run dev:desktop --home-dir "$PWD/.t3"
```

The development desktop uses the `t3code-dev` profile and the explicit `.t3` home.
Never point a development server at the live `~/.t3/userdata`. To test with existing
threads, copy a consistent snapshot into the development home using the
[test data procedure](../../AGENTS.md#test-data); do not symlink the live database.

Run checks for the files and packages changed:

```sh
vp test run <test-files>
vp lint <changed-files>
vp run --filter <package> typecheck
```

Check user-visible desktop behavior in the development app before merging the
branch. The [development guide](./development.md#checks) covers other focused checks.

## Integrate upstream

Fetch upstream and merge it into the fork's `main` before starting the next change,
or sooner when an upstream fix is needed. Merge completed feature branches into
`main` after their checks pass. Do not rebase or force-push the deployed `main`.

```sh
git fetch upstream
git switch main
git merge upstream/main
vp i --frozen-lockfile
```

Resolve conflicts against the current behavior, then run focused checks for the
affected areas. Push `main` to `origin` after it is verified. The existing GitHub
CI and release workflows use upstream infrastructure, including Blacksmith runners;
do not treat them as the fork's deployment mechanism. Keep the fork's scheduled
Release workflow disabled in GitHub Actions until it is adapted for this fork.

## Build and install

Build from a clean `main` checkout. Choose a unique preview version for each
personal deployment. Use the current upstream release's `X.Y.Z` as the base,
today's UTC date, and a sequence number that increases for another build on the
same date. For example, `0.0.43-preview.20260923.1`. The preview version keeps
the AppImage off the desktop auto-update feed, even when a GitHub repository is
present in the build environment. It displays the Alpha app branding.

```sh
git switch main
git status --short
git rev-parse HEAD
build_version=0.0.43-preview.20260923.1  # replace for this deployment
artifact_dir="$HOME/.local/share/t3code-builds/$build_version"
env -u GITHUB_REPOSITORY -u T3CODE_DESKTOP_UPDATE_REPOSITORY \
  vp run dist:desktop:artifact --platform linux --target AppImage --arch x64 \
  --build-version "$build_version" --output-dir "$artifact_dir"
sha256sum "$artifact_dir/T3-Code-$build_version-x86_64.AppImage"
```

Require an empty `git status --short` result before building. Use a fresh build,
without `--skip-build`, so the package contains the checked-out commit. Keep the
commit SHA, version, and artifact checksum with the deployment record. The build
embeds the commit in the app's About information.

Install the new artifact under a versioned filename and switch the existing
launcher. Do not stop the running desktop app from an agent session it hosts.

```sh
commit_short=$(git rev-parse --short=12 HEAD)
installed="$HOME/.local/opt/t3-code/T3-Code-local-$build_version-$commit_short-x86_64.AppImage"
install -Dm755 "$artifact_dir/T3-Code-$build_version-x86_64.AppImage" "$installed"
rm -f "$HOME/.local/bin/t3code.next"
ln -s "$installed" "$HOME/.local/bin/t3code.next"
mv -Tf "$HOME/.local/bin/t3code.next" "$HOME/.local/bin/t3code"
sed -i "s/^Name=.*/Name=T3 Code (Alpha)/; s/^X-AppImage-Version=.*/X-AppImage-Version=$build_version/" \
  "$HOME/.local/share/applications/t3code.desktop"
```

The visible desktop entry at `~/.local/share/applications/t3code.desktop` must
execute `~/.local/bin/t3code` using its absolute path. When the new app starts,
it refreshes its hidden Linux URL-handler entry to the running AppImage path.
If the running app supports local build replacement, its update control offers
**Restart to use new build** after the launcher switches. Otherwise, close and
reopen the app at a convenient time. Verify the About commit, existing threads,
and a provider session before removing the previous AppImage.

The production app continues using `~/.t3/userdata`. Before deploying a change
with database migrations, take a consistent `VACUUM INTO` snapshot of its live
SQLite database and retain the associated settings and secrets:

```sh
backup_dir="$HOME/.local/share/t3code-backups/$(date -u +%Y%m%dT%H%M%SZ)"
umask 077
mkdir -p "$backup_dir"
T3_BACKUP_DB="$backup_dir/state.sqlite" bun -e '
  const { Database } = require("bun:sqlite");
  const db = new Database(process.env.HOME + "/.t3/userdata/state.sqlite", { readonly: true });
  const quote = String.fromCharCode(39);
  const path = process.env.T3_BACKUP_DB.replaceAll(quote, quote + quote);
  db.run("VACUUM INTO " + quote + path + quote);
  db.close();
'
cp -a "$HOME/.t3/userdata/secrets" "$HOME/.t3/userdata/settings.json" "$backup_dir/"
```

`VACUUM INTO` gives a consistent database while the installed app is running.
Restoring an old AppImage after a migration may also require restoring its
matching data snapshot. Do not copy a live SQLite database file by itself.
