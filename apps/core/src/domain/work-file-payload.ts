import { distinctWorkPaths, shareableWorkPath, WORK_FILE_MAX, WORK_FILES_MAX } from "@colonia/protocol/project-files";
import { z } from "zod";

export const WorkFilePayload = z
  .array(
    z
      .object({
        path: z.string().refine((rel) => shareableWorkPath(rel) && rel === rel.normalize("NFC")),
        data: z
          .string()
          .max(Math.ceil(WORK_FILE_MAX / 3) * 4)
          .refine((data) => {
            const bytes = Buffer.from(data, "base64");
            return bytes.length <= WORK_FILE_MAX && bytes.toString("base64") === data;
          }),
      })
      .strict(),
  )
  .max(WORK_FILES_MAX)
  .refine(
    (files) =>
      distinctWorkPaths(files.map((file) => file.path)) &&
      files.reduce((sum, file) => sum + file.data.length, 0) <= 600_000,
  );
export type WorkFile = z.infer<typeof WorkFilePayload>[number];
