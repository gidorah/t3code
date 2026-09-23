// @effect-diagnostics nodeBuiltinImport:off -- Capture the running image before the launcher changes.
import * as NodeFS from "node:fs";
import { Option, Schema } from "effect";
import * as Effect from "effect/Effect";

import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as DesktopAppIdentity from "../../app/DesktopAppIdentity.ts";
import * as DesktopLifecycle from "../../app/DesktopLifecycle.ts";
import { findLocalAppImageReplacement } from "../../updates/localAppImageReplacement.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

const runningImagePath = (() => {
  try {
    return process.env.APPIMAGE ? NodeFS.realpathSync(process.env.APPIMAGE) : undefined;
  } catch {
    return undefined;
  }
})();

const replacementLauncher = Effect.fn("desktop.ipc.localAppImage.replacementLauncher")(
  function* () {
    const environment = yield* DesktopEnvironment.DesktopEnvironment;
    const identity = yield* DesktopAppIdentity.DesktopAppIdentity;
    const runningBuildCommitHash = Option.getOrUndefined(yield* identity.buildCommitHash);
    return yield* Effect.promise(() =>
      findLocalAppImageReplacement({
        platform: environment.platform,
        isPackaged: environment.isPackaged,
        homeDirectory: environment.homeDirectory,
        appImagePath: Option.getOrUndefined(environment.appImagePath),
        ...(runningBuildCommitHash ? { runningBuildCommitHash } : {}),
        ...(runningImagePath ? { runningImagePath } : {}),
      }),
    );
  },
);

export const getLocalAppImageReplacement = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LOCAL_APP_IMAGE_REPLACEMENT_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.localAppImage.getReplacement")(function* () {
    return (yield* replacementLauncher()) !== null;
  }),
});

export const restartWithLocalAppImage = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.LOCAL_APP_IMAGE_RESTART_CHANNEL,
  payload: Schema.Void,
  result: Schema.Boolean,
  handler: Effect.fn("desktop.ipc.localAppImage.restart")(function* () {
    const launcher = yield* replacementLauncher();
    if (launcher === null) return false;
    const lifecycle = yield* DesktopLifecycle.DesktopLifecycle;
    yield* lifecycle.relaunchWithExecutable("local AppImage replacement", launcher);
    return true;
  }),
});
