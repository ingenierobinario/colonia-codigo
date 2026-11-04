// The native adapter supplies secure randomness; the shared client still owns every protocol call.
import { randomUUID } from "expo-crypto";
import { type ClientOptions, ColoniaClient as ProtocolClient } from "../../../packages/protocol/src/client.ts";
import type { Params } from "../../../packages/protocol/src/index.ts";

export { ColoniaError, type ColoniaSocket, QUIET_HOURS, UPLOAD_LIMITS } from "../../../packages/protocol/src/client.ts";
export type {
  CoreEvent,
  Message,
  NoticePrefs,
  RoutineRun,
  Schedule,
  SharedFile,
  SharedKind,
  Surface,
  TaskEvent,
  Thread,
} from "../../../packages/protocol/src/index.ts";
export { noticeChannelChoice, noticeText } from "../../../packages/protocol/src/notices.ts";

/** The owner's answer to a pending input: a decision (with how long it lasts) or a text. */
export type Answer = Omit<Params<"runs.respond">, "input">;

export class ColoniaClient extends ProtocolClient {
  constructor(options: ClientOptions) {
    super({ ...options, requestKey: randomUUID });
  }
}
