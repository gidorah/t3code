// @effect-diagnostics nodeBuiltinImport:off -- AppImage relaunch must bypass Electron's no-new-privileges child process.
import * as NodeChildProcess from "node:child_process";

/** Start a launcher that waits for this process to exit before opening the new AppImage. */
export function spawnAppImageAfterExit(
  executable: string,
  args: readonly string[],
): Promise<NodeChildProcess.ChildProcess> {
  const env = { ...process.env };
  delete env.APPIMAGE;
  delete env.APPDIR;
  delete env.ARGV0;
  delete env.LD_LIBRARY_PATH;

  return new Promise((resolve, reject) => {
    const child = NodeChildProcess.spawn(
      "/bin/sh",
      ["-c", 'read -r _ || true; exec "$@"', "t3code-appimage-restart", executable, ...args],
      { detached: true, stdio: ["pipe", "ignore", "ignore"], env },
    );
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve(child);
    });
  });
}
