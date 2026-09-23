// @effect-diagnostics nodeBuiltinImport:off -- Real temporary symlinks and executable bits exercise the install boundary.
import * as NodeAssert from "node:assert";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterEach, it } from "@effect/vitest";

import { findLocalAppImageReplacement } from "./localAppImageReplacement.ts";

const homes: string[] = [];
afterEach(async () => {
  await Promise.all(
    homes.splice(0).map((home) => NodeFSP.rm(home, { recursive: true, force: true })),
  );
});

async function install() {
  const homeDirectory = await NodeFSP.mkdtemp(
    NodePath.join(NodeOS.tmpdir(), "t3-appimage-replacement-"),
  );
  homes.push(homeDirectory);
  const launcher = NodePath.join(homeDirectory, ".local/bin/t3code");
  const running = NodePath.join(homeDirectory, "old.AppImage");
  const replacement = NodePath.join(
    homeDirectory,
    ".local/opt/t3-code/T3-Code-local-0.0.43-preview.20260923.2-222222222222-x86_64.AppImage",
  );
  await NodeFSP.mkdir(NodePath.join(homeDirectory, ".local/bin"), { recursive: true });
  await NodeFSP.mkdir(NodePath.dirname(replacement), { recursive: true });
  const appImageHeader = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1, 1, 0, 0x41, 0x49, 2]);
  await NodeFSP.writeFile(running, appImageHeader);
  await NodeFSP.writeFile(replacement, appImageHeader);
  await NodeFSP.chmod(running, 0o755);
  await NodeFSP.chmod(replacement, 0o755);
  await NodeFSP.symlink(replacement, launcher);
  return {
    launcher,
    running,
    replacement,
    input: {
      platform: "linux" as const,
      isPackaged: true,
      homeDirectory,
      appImagePath: running,
      runningBuildCommitHash: "111111111111",
    },
  };
}

it("offers the stable launcher when a different executable AppImage is installed", async () => {
  const fixture = await install();
  NodeAssert.strict.equal(await findLocalAppImageReplacement(fixture.input), fixture.launcher);
});

it("recognizes replacement when the running AppImage was started through the same launcher", async () => {
  const fixture = await install();
  NodeAssert.strict.equal(
    await findLocalAppImageReplacement({
      ...fixture.input,
      appImagePath: fixture.launcher,
      runningImagePath: fixture.running,
    }),
    fixture.launcher,
  );
});

it("recognizes replacement from the startup image when APPIMAGE is unavailable", async () => {
  const fixture = await install();
  NodeAssert.strict.equal(
    await findLocalAppImageReplacement({
      ...fixture.input,
      appImagePath: undefined,
      runningImagePath: fixture.running,
    }),
    fixture.launcher,
  );
});

it("does not offer restart for an unchanged, missing, or nonexecutable target", async () => {
  const fixture = await install();
  await NodeFSP.unlink(fixture.launcher);
  await NodeFSP.symlink(fixture.running, fixture.launcher);
  NodeAssert.strict.equal(await findLocalAppImageReplacement(fixture.input), null);

  await NodeFSP.unlink(fixture.launcher);
  await NodeFSP.symlink(fixture.replacement, fixture.launcher);
  await NodeFSP.chmod(fixture.replacement, 0o644);
  NodeAssert.strict.equal(await findLocalAppImageReplacement(fixture.input), null);

  await NodeFSP.unlink(fixture.replacement);
  NodeAssert.strict.equal(await findLocalAppImageReplacement(fixture.input), null);
});

it("rejects an executable with an AppImage filename but no AppImage header", async () => {
  const fixture = await install();
  await NodeFSP.writeFile(fixture.replacement, "not an AppImage");
  NodeAssert.strict.equal(await findLocalAppImageReplacement(fixture.input), null);
});

it("ignores unrelated AppImages even when the launcher points to one", async () => {
  const fixture = await install();
  const unrelated = NodePath.join(NodePath.dirname(fixture.replacement), "Other.AppImage");
  await NodeFSP.rename(fixture.replacement, unrelated);
  await NodeFSP.unlink(fixture.launcher);
  await NodeFSP.symlink(unrelated, fixture.launcher);
  NodeAssert.strict.equal(await findLocalAppImageReplacement(fixture.input), null);

  const outsideInstall = NodePath.join(
    fixture.input.homeDirectory,
    NodePath.basename(fixture.replacement),
  );
  await NodeFSP.rename(unrelated, outsideInstall);
  await NodeFSP.unlink(fixture.launcher);
  await NodeFSP.symlink(outsideInstall, fixture.launcher);
  NodeAssert.strict.equal(await findLocalAppImageReplacement(fixture.input), null);
});

it("ignores a copied or hardlinked image that claims the running commit", async () => {
  const fixture = await install();
  const sameBuild = NodePath.join(
    NodePath.dirname(fixture.replacement),
    "T3-Code-local-0.0.43-preview.20260923.3-111111111111-x86_64.AppImage",
  );
  await NodeFSP.copyFile(fixture.running, sameBuild);
  await NodeFSP.unlink(fixture.launcher);
  await NodeFSP.symlink(sameBuild, fixture.launcher);
  NodeAssert.strict.equal(await findLocalAppImageReplacement(fixture.input), null);

  await NodeFSP.unlink(sameBuild);
  await NodeFSP.link(fixture.running, sameBuild);
  NodeAssert.strict.equal(await findLocalAppImageReplacement(fixture.input), null);
});

it("only operates in packaged Linux AppImage runs", async () => {
  const fixture = await install();
  NodeAssert.strict.equal(
    await findLocalAppImageReplacement({ ...fixture.input, isPackaged: false }),
    null,
  );
  NodeAssert.strict.equal(
    await findLocalAppImageReplacement({ ...fixture.input, platform: "darwin" }),
    null,
  );
  NodeAssert.strict.equal(
    await findLocalAppImageReplacement({ ...fixture.input, appImagePath: undefined }),
    null,
  );
});
