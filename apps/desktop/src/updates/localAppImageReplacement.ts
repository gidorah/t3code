// @effect-diagnostics nodeBuiltinImport:off -- Native filesystem checks establish the installed AppImage launcher and executable target.
import * as NodeFS from "node:fs";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";

export interface LocalAppImageInstall {
  readonly platform: NodeJS.Platform;
  readonly isPackaged: boolean;
  readonly homeDirectory: string;
  readonly appImagePath: string | undefined;
  /** Canonical running image captured at startup, before the launcher can change. */
  readonly runningImagePath?: string;
  /** Commit recorded in the running desktop package metadata. */
  readonly runningBuildCommitHash?: string;
}

/** Return the stable launcher only when it points at a different executable AppImage. */
export async function findLocalAppImageReplacement(
  install: LocalAppImageInstall,
): Promise<string | null> {
  if (
    install.platform !== "linux" ||
    !install.isPackaged ||
    (!install.appImagePath && !install.runningImagePath) ||
    !install.runningBuildCommitHash
  ) {
    return null;
  }

  const launcher = NodePath.join(install.homeDirectory, ".local/bin/t3code");
  try {
    if (!(await NodeFSP.lstat(launcher)).isSymbolicLink()) return null;
    const [runningImage, replacementImage] = await Promise.all([
      install.runningImagePath
        ? Promise.resolve(install.runningImagePath)
        : NodeFSP.realpath(install.appImagePath!),
      NodeFSP.realpath(launcher),
    ]);
    if (
      !runningImage.endsWith(".AppImage") ||
      runningImage === replacementImage ||
      !replacementImage.endsWith(".AppImage")
    ) {
      return null;
    }
    const installDirectory = NodePath.join(install.homeDirectory, ".local/opt/t3-code");
    const candidateName = NodePath.basename(replacementImage);
    const candidate = /^T3-Code-local-(.+)-([0-9a-f]{12})-x86_64\.AppImage$/.exec(candidateName);
    if (
      NodePath.dirname(replacementImage) !== installDirectory ||
      !candidate ||
      candidate[2] === install.runningBuildCommitHash.toLowerCase()
    ) {
      return null;
    }
    if (!(await NodeFSP.stat(replacementImage)).isFile()) return null;
    await NodeFSP.access(replacementImage, NodeFS.constants.X_OK);
    const file = await NodeFSP.open(replacementImage, "r");
    try {
      const header = Buffer.alloc(11);
      const { bytesRead } = await file.read(header, 0, header.length, 0);
      if (
        bytesRead !== header.length ||
        header.subarray(0, 4).toString("hex") !== "7f454c46" ||
        header.subarray(8).toString("hex") !== "414902"
      ) {
        return null;
      }
    } finally {
      await file.close();
    }
    return launcher;
  } catch {
    return null;
  }
}
