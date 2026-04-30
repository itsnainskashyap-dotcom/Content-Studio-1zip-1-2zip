import {
  pgTable,
  text,
  timestamp,
  uuid,
  jsonb,
  index,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users } from "./users";

/**
 * A user's saved ContentStudio project. The project body (story, parts,
 * prompts, character image references, etc.) is stored as a single JSONB
 * blob so we don't have to migrate the schema every time the in-app
 * `Project` type evolves. Heavy image bytes are NEVER stored here — only
 * `objectPath` references that point at Object Storage.
 *
 * Composite primary key (id, ownerId) lets two different users keep
 * client-generated project IDs without ever colliding, and indexes by
 * ownerId for the "list my projects" query.
 */
export const projects = pgTable(
  "projects",
  {
    id: text("id").notNull(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    data: jsonb("data").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.id, t.ownerId] }),
    index("projects_owner_updated_idx").on(t.ownerId, t.updatedAt),
  ],
);

export type ProjectRow = typeof projects.$inferSelect;
