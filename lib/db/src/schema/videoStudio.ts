import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  uuid,
  integer,
  jsonb,
  boolean,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * AI Video Studio job: a single end-to-end pipeline run that takes a
 * story (built via the existing Story Builder at /story) and produces a
 * stitched MP4 by orchestrating the continuous-frame video engine.
 *
 * The job row owns the high-level state (queued / running / complete /
 * failed) plus the user-facing progress fields the polling client
 * surfaces. Per-chunk detail lives in `videoChunks` so a long job stays
 * resumable and inspectable.
 *
 * Inputs (`inputStory`, `normalizedStory`, `visualBible`) are stored as
 * JSONB so the schema doesn't have to migrate every time the spec
 * evolves. Heavy bytes (reference frames, generated chunks, final MP4,
 * thumbnail) live in Object Storage; the row keeps only normalized
 * `/objects/...` paths.
 */
export const videoJobs = pgTable(
  "video_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    /** Internal model name; user-facing labels are "Cont Pro" / "Cont Ultra". */
    model: text("model").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    aspectRatio: text("aspect_ratio").notNull(),
    voiceoverLanguage: text("voiceover_language"),
    voiceoverEnabled: boolean("voiceover_enabled").notNull().default(false),
    bgmEnabled: boolean("bgm_enabled").notNull().default(true),
    subtitlesEnabled: boolean("subtitles_enabled").notNull().default(false),
    quality: text("quality").notNull().default("standard"),

    /** Optional reference to a saved Story Builder project. */
    storyProjectId: text("story_project_id"),
    /** Raw StoryResponse coming in from the Story Builder. */
    inputStory: jsonb("input_story").notNull(),
    /** Normalized into the spec's internal Story structure. */
    normalizedStory: jsonb("normalized_story"),
    /** Locked character + location + style reference sheet. */
    visualBible: jsonb("visual_bible"),

    /** queued | running | complete | failed | cancelled */
    status: text("status").notNull().default("queued"),
    /** Free-form short stage label for the UI. */
    stage: text("stage").notNull().default("queued"),
    /** Long human message shown next to the progress bar. */
    message: text("message").notNull().default("Waiting to start..."),
    progressPercent: integer("progress_percent").notNull().default(0),
    currentPart: integer("current_part").notNull().default(0),
    totalParts: integer("total_parts").notNull().default(0),

    /** Last error message if the job failed. */
    error: text("error"),

    /** Final stitched MP4 path in Object Storage (/objects/...). */
    finalVideoObjectPath: text("final_video_object_path"),
    /** Poster/thumbnail PNG path. */
    thumbnailObjectPath: text("thumbnail_object_path"),
    /** Concatenated voiceover script for the UI's caption panel. */
    voiceoverScript: text("voiceover_script"),

    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /**
     * Hard expiry — the boot sweeper deletes any row past this point
     * (cascading chunks + best-effort Object Storage cleanup). Default
     * is `now() + 30 days` set in SQL so back-fills and INSERTs both
     * get a sensible TTL without app-side date math.
     */
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .default(sql`now() + interval '30 days'`)
      .notNull(),
  },
  (t) => [
    index("video_jobs_owner_created_idx").on(t.ownerId, t.createdAt),
    index("video_jobs_status_idx").on(t.status),
    index("video_jobs_expires_at_idx").on(t.expiresAt),
  ],
);

export type VideoJob = typeof videoJobs.$inferSelect;

/**
 * One generated part (chunk) of a video job. Stored as the engine
 * progresses so a long Cont Ultra (15-part) run stays resumable and the
 * UI can surface per-part state.
 */
export const videoChunks = pgTable(
  "video_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => videoJobs.id, { onDelete: "cascade" }),
    partNumber: integer("part_number").notNull(),
    timeRangeStart: integer("time_range_start").notNull(),
    timeRangeEnd: integer("time_range_end").notNull(),
    /** Full model-specific JSON video prompt for this part. */
    jsonPrompt: jsonb("json_prompt"),
    /** Generated MP4 chunk in Object Storage. */
    videoObjectPath: text("video_object_path"),
    /** Real captured last frame (PNG) used to seed the next part. */
    lastFrameObjectPath: text("last_frame_object_path"),
    /** Claude-generated summary of what actually happened in this chunk. */
    summary: text("summary"),
    /** pending | generating | complete | failed */
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [index("video_chunks_job_part_idx").on(t.jobId, t.partNumber)],
);

export type VideoChunk = typeof videoChunks.$inferSelect;
