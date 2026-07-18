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
      // also skip if settings say we already did today
      if (cfg.lastAt) {
        const last = new Date(cfg.lastAt);
        if (dayKey(last) === key && cfg.lastStatus.startsWith("ok")) {
          lastFiredDay = key;
          return;
        }
      }
      lastFiredDay = key;
      console.log(`backup cron: sending scheduled backup at ${cfg.hour}:${String(cfg.minute).padStart(2, "0")}`);
      const r = await sendBackupToAdmins(api, { reason: "پشتیبان خودکار زمان‌بندی‌شده" });
      console.log("backup cron result", r);
    } catch (err) {
      console.error("backup cron error", err);
    }
  };

  setTimeout(tick, 20_000);
  return setInterval(tick, intervalMs);
}
