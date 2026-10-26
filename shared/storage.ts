import { z } from "zod";

/** Why the board is not (or not yet) in SQLite, or why it cannot be read (SQLITE-STORAGE-SPEC §9–10). */
export const storageReasons = ["exported", "unsupported", "migration-failed", "busy", "diverged", "missing", "invalid"] as const;
export type StorageReason = (typeof storageReasons)[number];

export const storageStatusSchema = z.strictObject({
  backend: z.enum(["sqlite", "json", "error"]),
  reason: z.enum(storageReasons).optional(),
  /** The daemon's own explanation (English), with the files involved. */
  detail: z.string().max(2000).optional(),
  directory: z.string(),
  databaseBytes: z.number().int().nonnegative().optional(),
  migratedAt: z.string().optional(),
  sqliteVersion: z.string().optional(),
  backups: z.array(z.strictObject({ name: z.string(), at: z.string(), bytes: z.number().int().nonnegative() })).max(50),
});
export type StorageStatus = z.infer<typeof storageStatusSchema>;
