import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { env } from "../config/env.js";
import { prisma } from "../db.js";
import { getSetting, setSetting } from "./settings.js";
import { listNotifyAdminTelegramIds } from "./users.js";
import type { Api } from "grammy";
import { InputFile } from "grammy";

export type BackupConfig = {
  enabled: boolean;
  /** Hour 0–23 (server local time) */
  hour: number;
  /** Minute 0–59 */
  minute: number;
  lastAt: string;
  lastStatus: string;
};

export function defaultBackupConfig(): BackupConfig {
  return {
    enabled: true,
    hour: 3,
    minute: 0,
    lastAt: "",
    lastStatus: "",
  };
}

export async function getBackupConfig(): Promise<BackupConfig> {
  const base = defaultBackupConfig();
  try {
    const raw = await getSetting("backup_config");
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<BackupConfig>) };
  } catch {
    /* fallthrough */
  }
  return base;
}

export async function saveBackupConfig(cfg: BackupConfig) {
  await setSetting("backup_config", JSON.stringify(cfg));
}

/** Resolve SQLite file path from DATABASE_URL (file:...). */
export function resolveDatabaseFilePath(): string {
  const url = env.DATABASE_URL || "file:./prisma/dev.db";
  let pathPart = url.replace(/^file:/, "");
  // Prisma sometimes uses file:./relative or file:/abs
  if (pathPart.startsWith("//")) {
    // file:///C:/... or file:///opt/...
    pathPart = pathPart.replace(/^\/\/\//, "/").replace(/^\/\//, "");
  }
  if (isAbsolute(pathPart) || /^[A-Za-z]:[\\/]/.test(pathPart)) {
    return pathPart;
  }
  return resolve(process.cwd(), pathPart);
}

async function backupDir(): Promise<string> {
  const db = resolveDatabaseFilePath();
  const dir = join(dirname(db), "backups");
  await mkdir(dir, { recursive: true });
  return dir;
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/**
 * Create a consistent SQLite snapshot file.
 * Prefers VACUUM INTO; falls back to copy after WAL checkpoint.
 */
export async function createDatabaseBackupFile(): Promise<{ path: string; size: number; name: string }> {
  const src = resolveDatabaseFilePath();
  const dir = await backupDir();
  const name = `quadtwo-backup-${stamp()}.db`;
  const dest = join(dir, name);

  try {
    // SQLite prefers forward slashes in VACUUM INTO paths
    const sqlPath = dest.replace(/\\/g, "/").replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`VACUUM INTO '${sqlPath}'`);
  } catch (err) {
    console.warn("VACUUM INTO failed, falling back to copy", err);
    try {
      await prisma.$executeRawUnsafe(`PRAGMA wal_checkpoint(TRUNCATE)`);
    } catch {
      /* ignore */
    }
    await copyFile(src, dest);
    // also copy wal/shm if present
    for (const suffix of ["-wal", "-shm"]) {
      try {
        await copyFile(src + suffix, dest + suffix);
      } catch {
        /* none */
      }
    }
  }

  const s = await stat(dest);
  return { path: dest, size: s.size, name };
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

const SQLITE_MAGIC = Buffer.from("SQLite format 3\0");

export function isSqliteDatabaseBuffer(buf: Buffer): boolean {
  return buf.length >= SQLITE_MAGIC.length && buf.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC);
}

export type BackupInspectResult =
  | {
      ok: true;
      size: number;
      sizeLabel: string;
      users?: number;
      orders?: number;
      subscriptions?: number;
      discountCodes?: number;
      note?: string;
    }
  | { ok: false; error: string };

/** Validate uploaded backup and optionally read table counts (dry-run). */
export async function inspectBackupBuffer(buf: Buffer): Promise<BackupInspectResult> {
  if (!buf?.length) return { ok: false, error: "فایل خالی است" };
  if (!isSqliteDatabaseBuffer(buf)) {
    return { ok: false, error: "فایل معتبر SQLite نیست (باید خروجی پشتیبان Quadtwo باشد)" };
  }
  if (buf.length < 4096) {
    return { ok: false, error: "حجم فایل پشتیبان مشکوک / خیلی کوچک است" };
  }

  const base: BackupInspectResult = {
    ok: true,
    size: buf.length,
    sizeLabel: formatBytes(buf.length),
  };

  try {
    const { writeFile, unlink } = await import("node:fs/promises");
    const dir = await backupDir();
    const tmp = join(dir, `inspect-${stamp()}.db`);
    await writeFile(tmp, buf);
    try {
      const { DatabaseSync } = await import("node:sqlite");
      const db = new DatabaseSync(tmp, { readOnly: true });
      const count = (table: string) => {
        try {
          const row = db.prepare(`SELECT COUNT(*) AS n FROM "${table}"`).get() as { n?: number } | undefined;
          return Number(row?.n ?? 0);
        } catch {
          return undefined;
        }
      };
      const users = count("User");
      const orders = count("Order");
      const subscriptions = count("Subscription");
      const discountCodes = count("DiscountCode");
      db.close();
      return {
        ...base,
        users,
        orders,
        subscriptions,
        discountCodes,
        note: "فایل معتبر است؛ بازیابی دیتابیس فعلی را جایگزین می‌کند.",
      };
    } finally {
      try {
        await unlink(tmp);
      } catch {
        /* ignore */
      }
    }
  } catch {
    return {
      ...base,
      note: "هدر SQLite معتبر است (شمارش جداول در این محیط در دسترس نبود).",
    };
  }
}

/** List recent backup / safety files in the backups directory. */
export async function listBackupFiles(limit = 15): Promise<
  Array<{ name: string; size: number; sizeLabel: string; mtime: string; kind: "backup" | "safety" | "other" }>
> {
  const { readdir } = await import("node:fs/promises");
  const dir = await backupDir();
  const names = (await readdir(dir)).filter((n) => n.endsWith(".db"));
  const withStat = await Promise.all(
    names.map(async (name) => {
      const p = join(dir, name);
      const s = await stat(p);
      const kind: "backup" | "safety" | "other" = name.startsWith("pre-restore-")
        ? "safety"
        : name.startsWith("quadtwo-backup-")
          ? "backup"
          : "other";
      return {
        name,
        size: s.size,
        sizeLabel: formatBytes(s.size),
        mtime: new Date(s.mtimeMs).toISOString(),
        kind,
      };
    }),
  );
  withStat.sort((a, b) => (a.mtime < b.mtime ? 1 : -1));
  return withStat.slice(0, Math.max(1, limit));
}

export async function pruneOldBackups(keep = 14): Promise<number> {
  const { readdir, unlink } = await import("node:fs/promises");
  const dir = await backupDir();
  const names = (await readdir(dir)).filter((n) => n.endsWith(".db"));
  const withStat = await Promise.all(
    names.map(async (name) => {
      const p = join(dir, name);
      const s = await stat(p);
      return { path: p, mtime: s.mtimeMs };
    }),
  );
  withStat.sort((a, b) => b.mtime - a.mtime);
  let removed = 0;
  for (const f of withStat.slice(Math.max(1, keep))) {
    try {
      await unlink(f.path);
      removed++;
    } catch {
      /* ignore */
    }
  }
  return removed;
}

/**
 * Replace the live SQLite DB with a backup file buffer.
 * Creates a safety snapshot of the current DB first, then swaps files.
 * Caller should restart the process so Prisma reconnects cleanly.
 */
export async function restoreDatabaseFromBackupBuffer(
  buf: Buffer,
): Promise<{ ok: true; safetyName: string; size: number } | { ok: false; error: string }> {
  const { isDemoMode } = await import("./license.js");
  if (isDemoMode()) {
    return { ok: false, error: "در حالت دمو بازیابی پشتیبان غیرفعال است" };
  }
  const inspected = await inspectBackupBuffer(buf);
  if (!inspected.ok) return inspected;

  const src = resolveDatabaseFilePath();
  const dir = await backupDir();
  const incoming = join(dir, `restore-incoming-${stamp()}.db`);
  const safetyName = `pre-restore-${stamp()}.db`;
  const safety = join(dir, safetyName);

  try {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(incoming, buf);

    // Safety snapshot of current live DB
    try {
      const sqlPath = safety.replace(/\\/g, "/").replace(/'/g, "''");
      await prisma.$executeRawUnsafe(`VACUUM INTO '${sqlPath}'`);
    } catch {
      try {
        await prisma.$executeRawUnsafe(`PRAGMA wal_checkpoint(TRUNCATE)`);
      } catch {
        /* ignore */
      }
      await copyFile(src, safety);
    }

    const cfg = await getBackupConfig();
    cfg.lastAt = new Date().toISOString();
    cfg.lastStatus = `restored; safety=${safetyName}; size=${formatBytes(buf.length)}`;
    await saveBackupConfig(cfg);

    await prisma.$disconnect().catch(() => undefined);

    await copyFile(incoming, src);
    for (const suffix of ["-wal", "-shm"]) {
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(src + suffix);
      } catch {
        /* none */
      }
    }

    void pruneOldBackups(20).catch(() => undefined);
    return { ok: true, safetyName, size: buf.length };
  } catch (err) {
    return { ok: false, error: String(err instanceof Error ? err.message : err) };
  }
}

/** Create backup and send the file to all admin Telegram IDs. */
export async function sendBackupToAdmins(
  api: Api,
  opts?: { reason?: string; toChatId?: number },
): Promise<{ ok: boolean; name: string; size: number; sent: number; error?: string }> {
  try {
    const file = await createDatabaseBackupFile();
    const caption = [
      "💾 پشتیبان دیتابیس Quadtwo",
      opts?.reason ? `علت: ${opts.reason}` : "",
      `فایل: ${file.name}`,
      `حجم: ${formatBytes(file.size)}`,
      `زمان: ${new Date().toLocaleString("fa-IR")}`,
    ]
      .filter(Boolean)
      .join("\n");

    const targets = opts?.toChatId
      ? [opts.toChatId]
      : await listNotifyAdminTelegramIds();

    let sent = 0;
    for (const id of targets) {
      try {
        await api.sendDocument(id, new InputFile(file.path, file.name), { caption });
        sent++;
      } catch (err) {
        console.error("backup send failed", id, err);
      }
    }

    const cfg = await getBackupConfig();
    cfg.lastAt = new Date().toISOString();
    cfg.lastStatus = sent > 0 ? `ok sent=${sent}` : "send_failed";
    await saveBackupConfig(cfg);

    return { ok: sent > 0, name: file.name, size: file.size, sent };
  } catch (err) {
    const cfg = await getBackupConfig();
    cfg.lastAt = new Date().toISOString();
    cfg.lastStatus = `error: ${String(err)}`;
    await saveBackupConfig(cfg);
    return { ok: false, name: "", size: 0, sent: 0, error: String(err) };
  }
}

function dayKey(d = new Date()) {
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * Poll every minute; when local time matches configured hour:minute and not yet run today, send backup.
 */
export function startBackupCron(api: Api, intervalMs = 60_000) {
  let lastFiredDay = "";

  const tick = async () => {
    try {
      const cfg = await getBackupConfig();
      if (!cfg.enabled) return;
      const now = new Date();
      if (now.getHours() !== cfg.hour || now.getMinutes() !== cfg.minute) return;
      const key = dayKey(now);
      if (lastFiredDay === key) return;
      // also skip if settings say we already did today successfully
      if (cfg.lastAt) {
        const last = new Date(cfg.lastAt);
        if (dayKey(last) === key && cfg.lastStatus.startsWith("ok")) {
          lastFiredDay = key;
          return;
        }
      }
      console.log(`backup cron: sending scheduled backup at ${cfg.hour}:${String(cfg.minute).padStart(2, "0")}`);
      const r = await sendBackupToAdmins(api, { reason: "پشتیبان خودکار زمان‌بندی‌شده" });
      console.log("backup cron result", r);
      if (r.ok) {
        lastFiredDay = key;
        void pruneOldBackups(20).catch((err) => console.warn("backup prune", err));
      }
    } catch (err) {
      console.error("backup cron error", err);
    }
  };

  setTimeout(tick, 20_000);
  return setInterval(tick, intervalMs);
}
