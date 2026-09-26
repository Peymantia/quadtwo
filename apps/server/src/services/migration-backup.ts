import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import JSZip from "jszip";
import { prisma } from "../db.js";
import { isDemoMode } from "./license.js";
import {
  createDatabaseBackupFile,
  inspectBackupBuffer,
  isSqliteDatabaseBuffer,
  resolveDatabaseFilePath,
  restoreDatabaseFromBackupBuffer,
} from "./backup.js";
import { createXuiFromPanel, listPanelServers } from "./panel-servers.js";
import { listNotifyAdminTelegramIds } from "./users.js";
import type { Api } from "grammy";
import { InputFile } from "grammy";

export const MIGRATION_MANIFEST = "manifest.json";
export const MIGRATION_VERSION = 2;

export type ClientTrafficSnap = {
  email: string;
  up: number;
  down: number;
  /** total quota bytes (0 = unlimited) */
  total: number;
  used: number;
  /** remaining bytes; null if unlimited */
  remaining: number | null;
  totalGb: number | null;
  usedGb: number;
  remainingGb: number | null;
};

export type MigrationPanelEntry = {
  id: string;
  name: string;
  baseUrl: string;
  inboundIds: string;
  subBase: string | null;
  categories: string;
  active: boolean;
  sellEnabled: boolean;
  weight: number;
  dbPath: string;
  dbFilename: string;
  dbBytes: number;
  dbSha256: string;
  /** Relative path to client-traffic.json inside the zip */
  trafficPath?: string;
  trafficClients?: number;
  ok: boolean;
  error?: string;
};

export type MigrationManifest = {
  version: number;
  kind: "quadtwo-full-migration";
  createdAt: string;
  app: string;
  bot: {
    path: string;
    bytes: number;
    sha256: string;
  };
  panels: MigrationPanelEntry[];
  notes: string[];
};

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function sha256(buf: Buffer) {
  return createHash("sha256").update(buf).digest("hex");
}

async function snapshotPanelClientTraffic(
  xui: ReturnType<typeof createXuiFromPanel>,
): Promise<ClientTrafficSnap[]> {
  const { bytesToGb } = await import("../utils/format.js");
  const byEmail = new Map<string, ClientTrafficSnap>();

  // Prefer clients/list (may include traffic nested); always enrich with traffic API.
  let emails: string[] = [];
  try {
    const listed = await xui.listClients();
    const rows = Array.isArray(listed.obj) ? listed.obj : [];
    for (const c of rows) {
      const email = typeof c.email === "string" ? c.email.trim() : "";
      if (!email) continue;
      emails.push(email);
      const traf = (c as { traffic?: { up?: number; down?: number } }).traffic;
      const up = Number(traf?.up ?? 0);
      const down = Number(traf?.down ?? 0);
      const total = Number(c.totalGB ?? 0);
      const used = up + down;
      byEmail.set(email.toLowerCase(), {
        email,
        up,
        down,
        total,
        used,
        remaining: total > 0 ? Math.max(0, total - used) : null,
        totalGb: bytesToGb(total),
        usedGb: bytesToGb(used) ?? used / 1024 ** 3,
        remainingGb: total > 0 ? bytesToGb(Math.max(0, total - used)) : null,
      });
    }
  } catch {
    /* fall through — try inbounds */
  }

  if (!emails.length) {
    try {
      const res = await xui.listInbounds();
      const inbounds = Array.isArray(res.obj) ? res.obj : [];
      for (const ib of inbounds as Array<{
        clientStats?: Array<{ email?: string; up?: number; down?: number; total?: number }>;
        settings?: string | { clients?: Array<{ email?: string; totalGB?: number }> };
      }>) {
        if (Array.isArray(ib.clientStats)) {
          for (const s of ib.clientStats) {
            const email = s.email?.trim();
            if (!email) continue;
            emails.push(email);
            const up = Number(s.up ?? 0);
            const down = Number(s.down ?? 0);
            const total = Number(s.total ?? 0);
            const used = up + down;
            byEmail.set(email.toLowerCase(), {
              email,
              up,
              down,
              total,
              used,
              remaining: total > 0 ? Math.max(0, total - used) : null,
              totalGb: bytesToGb(total),
              usedGb: bytesToGb(used) ?? used / 1024 ** 3,
              remainingGb: total > 0 ? bytesToGb(Math.max(0, total - used)) : null,
            });
          }
        }
        let clients: Array<{ email?: string; totalGB?: number }> | undefined;
        if (typeof ib.settings === "string") {
          try {
            clients = (JSON.parse(ib.settings) as { clients?: Array<{ email?: string; totalGB?: number }> })
              .clients;
          } catch {
            clients = undefined;
          }
        } else if (ib.settings && typeof ib.settings === "object") {
          clients = ib.settings.clients;
        }
        if (Array.isArray(clients)) {
          for (const c of clients) {
            const email = c.email?.trim();
            if (!email) continue;
            if (!byEmail.has(email.toLowerCase())) {
              emails.push(email);
              const total = Number(c.totalGB ?? 0);
              byEmail.set(email.toLowerCase(), {
                email,
                up: 0,
                down: 0,
                total,
                used: 0,
                remaining: total > 0 ? total : null,
                totalGb: bytesToGb(total),
                usedGb: 0,
                remainingGb: bytesToGb(total),
              });
            }
          }
        }
      }
    } catch {
      /* empty */
    }
  }

  // Enrich / correct with dedicated traffic endpoint (up to 80 concurrent batches)
  const unique = [...new Set(emails.map((e) => e.trim()).filter(Boolean))];
  const chunk = 25;
  for (let i = 0; i < unique.length; i += chunk) {
    const slice = unique.slice(i, i + chunk);
    await Promise.all(
      slice.map(async (email) => {
        try {
          const t = await xui.getClientTraffic(email);
          if (!t) return;
          const prev = byEmail.get(email.toLowerCase());
          const total = t.total > 0 ? t.total : (prev?.total ?? 0);
          const used = t.used;
          byEmail.set(email.toLowerCase(), {
            email,
            up: t.up,
            down: t.down,
            total,
            used,
            remaining: total > 0 ? Math.max(0, total - used) : null,
            totalGb: bytesToGb(total),
            usedGb: bytesToGb(used) ?? used / 1024 ** 3,
            remainingGb: total > 0 ? bytesToGb(Math.max(0, total - used)) : null,
          });
        } catch {
          /* keep list snapshot */
        }
      }),
    );
  }

  return [...byEmail.values()].sort((a, b) => a.email.localeCompare(b.email));
}

async function migrationDir(): Promise<string> {
  const db = resolveDatabaseFilePath();
  const dir = join(dirname(db), "backups", "migration");
  await mkdir(dir, { recursive: true });
  return dir;
}

/**
 * Build a zip: bot SQLite + each active PanelServer's 3x-ui database
 * (inbounds, clients, groups, nodes, hosts, outbounds, routings, settings).
 */
export async function createFullMigrationArchive(): Promise<{
  path: string;
  name: string;
  size: number;
  manifest: MigrationManifest;
}> {
  if (isDemoMode()) {
    throw new Error("در حالت دمو بکاپ کامل مهاجرت غیرفعال است");
  }

  const botFile = await createDatabaseBackupFile();
  const botBuf = await readFile(botFile.path);

  const zip = new JSZip();
  const notes: string[] = [
    "بکاپ کامل مهاجرت Quadtwo = دیتابیس ربات + دیتابیس پنل(های) 3x-ui + اسنپ‌شات مصرف ترافیک کلاینت‌ها.",
    "ترتیب بازیابی پیشنهادی: ۱) نصب 3x-ui تازه ۲) Import دیتابیس پنل ۳) بازیابی ربات ۴) اعمال اسنپ‌شات ترافیک (خودکار در بازیابی کامل) ۵) اصلاح baseUrl در سرورها اگر دامنه عوض شده.",
    "فایل client-traffic.json برای هر پنل: up/down/used/total/remaining — اگر پنل حجم را ریست کرد، از همین فایل دوباره اعمال می‌شود.",
    "فایل .env (BOT_TOKEN و دامنه) داخل این آرشیو نیست — جداگانه نگه دارید.",
  ];

  zip.file(`bot/${botFile.name}`, botBuf);
  zip.file(
    "bot/README.txt",
    "فایل SQLite ربات. از داشبورد → پشتیبان → بازیابی، یا از داخل آرشیو کامل بازیابی کنید.\n",
  );

  const panels = await listPanelServers();
  const panelEntries: MigrationPanelEntry[] = [];

  for (const p of panels) {
    const folder = `panels/${p.id}`;
    const meta = {
      id: p.id,
      name: p.name,
      baseUrl: p.baseUrl,
      inboundIds: p.inboundIds,
      subBase: p.subBase,
      categories: p.categories,
      active: p.active,
      sellEnabled: p.sellEnabled,
      weight: p.weight,
      // Token is already in bot DB; keep fingerprint only in meta for safety in loose copies
      apiTokenSha256: p.apiToken ? sha256(Buffer.from(p.apiToken, "utf8")) : null,
    };
    zip.file(`${folder}/panel-meta.json`, JSON.stringify(meta, null, 2));

    if (!p.apiToken?.trim()) {
      panelEntries.push({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        inboundIds: p.inboundIds,
        subBase: p.subBase,
        categories: p.categories,
        active: p.active,
        sellEnabled: p.sellEnabled,
        weight: p.weight,
        dbPath: "",
        dbFilename: "",
        dbBytes: 0,
        dbSha256: "",
        ok: false,
        error: "apiToken خالی است",
      });
      continue;
    }

    try {
      const xui = createXuiFromPanel(p);
      const db = await xui.downloadDatabase();
      const dbPath = `${folder}/${db.filename}`;
      zip.file(dbPath, db.buffer);

      let trafficPath = "";
      let trafficClients = 0;
      try {
        const snaps = await snapshotPanelClientTraffic(xui);
        trafficPath = `${folder}/client-traffic.json`;
        zip.file(
          trafficPath,
          JSON.stringify(
            {
              panelId: p.id,
              panelName: p.name,
              capturedAt: new Date().toISOString(),
              clients: snaps,
            },
            null,
            2,
          ),
        );
        trafficClients = snaps.length;
      } catch (trafErr) {
        notes.push(
          `اسنپ‌شات ترافیک «${p.name}» گرفته نشد: ${String(trafErr instanceof Error ? trafErr.message : trafErr)}`,
        );
      }

      panelEntries.push({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        inboundIds: p.inboundIds,
        subBase: p.subBase,
        categories: p.categories,
        active: p.active,
        sellEnabled: p.sellEnabled,
        weight: p.weight,
        dbPath,
        dbFilename: db.filename,
        dbBytes: db.buffer.length,
        dbSha256: sha256(db.buffer),
        trafficPath: trafficPath || undefined,
        trafficClients,
        ok: true,
      });
    } catch (err) {
      const msg = String(err instanceof Error ? err.message : err);
      notes.push(`پنل «${p.name}» دانلود نشد: ${msg}`);
      panelEntries.push({
        id: p.id,
        name: p.name,
        baseUrl: p.baseUrl,
        inboundIds: p.inboundIds,
        subBase: p.subBase,
        categories: p.categories,
        active: p.active,
        sellEnabled: p.sellEnabled,
        weight: p.weight,
        dbPath: "",
        dbFilename: "",
        dbBytes: 0,
        dbSha256: "",
        ok: false,
        error: msg,
      });
    }
  }

  const okPanels = panelEntries.filter((x) => x.ok).length;
  if (panels.length > 0 && okPanels === 0) {
    throw new Error(
      "هیچ دیتابیس پنلی دانلود نشد. توکن API و دسترسی getDb پنل را بررسی کنید (نسخه 3x-ui باید API بکاپ داشته باشد).",
    );
  }

  const manifest: MigrationManifest = {
    version: MIGRATION_VERSION,
    kind: "quadtwo-full-migration",
    createdAt: new Date().toISOString(),
    app: "quadtwo",
    bot: {
      path: `bot/${botFile.name}`,
      bytes: botBuf.length,
      sha256: sha256(botBuf),
    },
    panels: panelEntries,
    notes,
  };
  zip.file(MIGRATION_MANIFEST, JSON.stringify(manifest, null, 2));
  zip.file(
    "README.txt",
    [
      "بکاپ کامل مهاجرت Quadtwo",
      "========================",
      "",
      ...notes,
      "",
      `ربات: ${manifest.bot.path} (${formatBytes(manifest.bot.bytes)})`,
      `پنل‌های موفق: ${okPanels} از ${panels.length}`,
      `اسنپ‌شات ترافیک: ${panelEntries.reduce((s, p) => s + (p.trafficClients ?? 0), 0)} کلاینت`,
      "",
      "بازیابی پنل دستی (اگر API import کار نکرد):",
      "  1) سرویس x-ui را stop کنید",
      "  2) فایل panels/<id>/x-ui.db را جای دیتابیس پنل بگذارید",
      "  3) سرویس را start کنید",
      "  4) از داشبورد بازیابی کامل بزنید یا client-traffic.json را با API اعمال کنید",
      "",
    ].join("\n"),
  );

  const outName = `quadtwo-full-${stamp()}.zip`;
  const dir = await migrationDir();
  const outPath = join(dir, outName);
  const content = await zip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 6 },
  });
  await writeFile(outPath, content);
  const s = await stat(outPath);

  return { path: outPath, name: outName, size: s.size, manifest };
}

export type MigrationInspectResult =
  | {
      ok: true;
      kind: "full-migration" | "bot-db-only";
      createdAt?: string;
      botBytes?: number;
      panelsOk?: number;
      panelsTotal?: number;
      panels?: Array<{
        name: string;
        ok: boolean;
        error?: string;
        dbBytes?: number;
        trafficClients?: number;
      }>;
      notes?: string[];
      sizeLabel: string;
    }
  | { ok: false; error: string };

export async function inspectMigrationOrBotBackup(buf: Buffer): Promise<MigrationInspectResult> {
  // Plain bot SQLite
  if (isSqliteDatabaseBuffer(buf)) {
    const r = await inspectBackupBuffer(buf);
    if (!r.ok) return r;
    return {
      ok: true,
      kind: "bot-db-only",
      sizeLabel: formatBytes(buf.length),
      botBytes: buf.length,
      notes: ["این فقط دیتابیس ربات است (بدون پنل 3x-ui)."],
    };
  }

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    return { ok: false, error: "فایل نه SQLite ربات است نه zip مهاجرت کامل" };
  }

  const manFile = zip.file(MIGRATION_MANIFEST);
  if (!manFile) {
    return { ok: false, error: "داخل zip فایل manifest.json پیدا نشد" };
  }
  let manifest: MigrationManifest;
  try {
    manifest = JSON.parse(await manFile.async("string")) as MigrationManifest;
  } catch {
    return { ok: false, error: "manifest.json نامعتبر است" };
  }
  if (manifest.kind !== "quadtwo-full-migration") {
    return { ok: false, error: "این zip بکاپ کامل مهاجرت Quadtwo نیست" };
  }

  return {
    ok: true,
    kind: "full-migration",
    createdAt: manifest.createdAt,
    botBytes: manifest.bot.bytes,
    panelsOk: manifest.panels.filter((p) => p.ok).length,
    panelsTotal: manifest.panels.length,
    panels: manifest.panels.map((p) => ({
      name: p.name,
      ok: p.ok,
      error: p.error,
      dbBytes: p.dbBytes,
      trafficClients: p.trafficClients ?? 0,
    })),
    notes: manifest.notes,
    sizeLabel: formatBytes(buf.length),
  };
}

export type FullRestoreOptions = {
  /** Import each panel DB via 3x-ui API (destructive on panel). Default true when panels present. */
  importPanels?: boolean;
  /** Restore bot SQLite and schedule process exit. Default true. */
  restoreBot?: boolean;
  /** Re-apply used traffic from client-traffic.json after panel import. Default true. */
  restoreTraffic?: boolean;
};

async function applyTrafficSnapshotFromZip(
  zip: JSZip,
  entry: MigrationPanelEntry,
  panel: { baseUrl: string; apiToken: string; name: string },
): Promise<{ applied: number; failed: number; errors: string[] }> {
  const path =
    entry.trafficPath ||
    (entry.dbPath ? entry.dbPath.replace(/[^/]+$/, "client-traffic.json") : "");
  if (!path) return { applied: 0, failed: 0, errors: ["اسنپ‌شات ترافیک در zip نیست"] };
  const f = zip.file(path);
  if (!f) return { applied: 0, failed: 0, errors: [`فایل ${path} پیدا نشد`] };

  let clients: ClientTrafficSnap[] = [];
  try {
    const raw = JSON.parse(await f.async("string")) as { clients?: ClientTrafficSnap[] };
    clients = Array.isArray(raw.clients) ? raw.clients : [];
  } catch {
    return { applied: 0, failed: 0, errors: ["client-traffic.json نامعتبر است"] };
  }

  const xui = createXuiFromPanel(panel);
  let applied = 0;
  let failed = 0;
  const errors: string[] = [];
  for (const c of clients) {
    if (!c.email?.trim()) continue;
    if (!(c.up > 0 || c.down > 0)) {
      applied++; // nothing to write
      continue;
    }
    try {
      await xui.updateClientTraffic(c.email, { upload: c.up, download: c.down });
      applied++;
    } catch (err) {
      failed++;
      if (errors.length < 8) {
        errors.push(`${c.email}: ${String(err instanceof Error ? err.message : err).slice(0, 120)}`);
      }
    }
  }
  return { applied, failed, errors };
}

/**
 * Restore from full migration zip.
 * Panel import uses current PanelServer baseUrl+token (update URLs first if host changed).
 */
export async function restoreFullMigrationArchive(
  buf: Buffer,
  opts?: FullRestoreOptions,
): Promise<
  | {
      ok: true;
      botRestored: boolean;
      safetyName?: string;
      panelsImported: number;
      trafficApplied: number;
      trafficFailed: number;
      panelErrors: Array<{ name: string; error: string }>;
      message: string;
    }
  | { ok: false; error: string }
> {
  if (isDemoMode()) {
    return { ok: false, error: "در حالت دمو بازیابی غیرفعال است" };
  }

  const importPanels = opts?.importPanels !== false;
  const restoreBot = opts?.restoreBot !== false;
  const restoreTraffic = opts?.restoreTraffic !== false;

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buf);
  } catch {
    return { ok: false, error: "zip نامعتبر است" };
  }
  const manFile = zip.file(MIGRATION_MANIFEST);
  if (!manFile) return { ok: false, error: "manifest.json نیست" };

  let manifest: MigrationManifest;
  try {
    manifest = JSON.parse(await manFile.async("string")) as MigrationManifest;
  } catch {
    return { ok: false, error: "manifest خراب است" };
  }

  const panelErrors: Array<{ name: string; error: string }> = [];
  let panelsImported = 0;
  let trafficApplied = 0;
  let trafficFailed = 0;

  if (importPanels) {
    for (const entry of manifest.panels) {
      if (!entry.ok || !entry.dbPath) continue;
      const f = zip.file(entry.dbPath);
      if (!f) {
        panelErrors.push({ name: entry.name, error: "فایل دیتابیس داخل zip نیست" });
        continue;
      }
      const panelBuf = Buffer.from(await f.async("uint8array"));
      const live = await prisma.panelServer.findUnique({ where: { id: entry.id } });
      // Prefer live row (may have new baseUrl); else try by name
      const target =
        live ??
        (await prisma.panelServer.findFirst({
          where: { name: entry.name },
        }));
      if (!target?.apiToken) {
        panelErrors.push({
          name: entry.name,
          error: "سرور پنل در ربات پیدا نشد یا توکن ندارد — اول بکاپ ربات را برگردانید یا سرور را دستی بسازید",
        });
        continue;
      }
      try {
        const xui = createXuiFromPanel(target);
        await xui.importDatabase(panelBuf, entry.dbFilename || "x-ui.db");
        panelsImported++;
        if (restoreTraffic) {
          // Give panel a moment after importDB restart
          await new Promise((r) => setTimeout(r, 1500));
          const traf = await applyTrafficSnapshotFromZip(zip, entry, target);
          trafficApplied += traf.applied;
          trafficFailed += traf.failed;
          if (traf.failed && traf.errors.length) {
            panelErrors.push({
              name: `${entry.name} (ترافیک)`,
              error: traf.errors.join(" · "),
            });
          }
        }
      } catch (err) {
        panelErrors.push({
          name: entry.name,
          error: String(err instanceof Error ? err.message : err),
        });
      }
    }
  } else if (restoreTraffic) {
    // Traffic-only pass (panel DB already live)
    for (const entry of manifest.panels) {
      if (!entry.ok) continue;
      const live =
        (await prisma.panelServer.findUnique({ where: { id: entry.id } })) ??
        (await prisma.panelServer.findFirst({ where: { name: entry.name } }));
      if (!live?.apiToken) {
        panelErrors.push({ name: entry.name, error: "پنل برای اعمال ترافیک پیدا نشد" });
        continue;
      }
      const traf = await applyTrafficSnapshotFromZip(zip, entry, live);
      trafficApplied += traf.applied;
      trafficFailed += traf.failed;
      if (traf.failed && traf.errors.length) {
        panelErrors.push({ name: `${entry.name} (ترافیک)`, error: traf.errors.join(" · ") });
      }
    }
  }

  let botRestored = false;
  let safetyName: string | undefined;
  if (restoreBot) {
    const botPath = manifest.bot.path;
    const botFile = zip.file(botPath);
    if (!botFile) {
      return { ok: false, error: `فایل ربات داخل zip نیست: ${botPath}` };
    }
    const botBuf = Buffer.from(await botFile.async("uint8array"));
    const r = await restoreDatabaseFromBackupBuffer(botBuf);
    if (!r.ok) return { ok: false, error: r.error };
    botRestored = true;
    safetyName = r.safetyName;
  }

  const message = [
    botRestored ? "دیتابیس ربات بازیابی شد (سرویس به‌زودی ری‌استارت می‌شود)." : "ربات بازیابی نشد.",
    importPanels
      ? `پنل‌ها: ${panelsImported} موفق` +
        (panelErrors.length ? ` · ${panelErrors.length} هشدار/خطا` : "")
      : "وارد کردن پنل‌ها رد شد.",
    restoreTraffic
      ? `ترافیک مصرفی: ${trafficApplied} اعمال` +
        (trafficFailed ? ` · ${trafficFailed} ناموفق` : "")
      : "",
    panelErrors.length
      ? "اگر import API شکست خورد، فایل x-ui.db را دستی جای دیتابیس پنل بگذارید (راهنمای README داخل zip)."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  return {
    ok: true,
    botRestored,
    safetyName,
    panelsImported,
    trafficApplied,
    trafficFailed,
    panelErrors,
    message,
  };
}

/** Create full archive and send to admins (Telegram ~50MB limit). */
export async function sendFullMigrationToAdmins(
  api: Api,
  opts?: { reason?: string; toChatId?: number },
): Promise<{
  ok: boolean;
  name: string;
  size: number;
  sent: number;
  panelsOk: number;
  panelsTotal: number;
  error?: string;
  path?: string;
}> {
  try {
    const file = await createFullMigrationArchive();
    const caption = [
      "📦 بکاپ کامل مهاجرت (ربات + پنل 3x-ui)",
      opts?.reason ? `علت: ${opts.reason}` : "",
      `فایل: ${file.name}`,
      `حجم: ${formatBytes(file.size)}`,
      `پنل‌ها: ${file.manifest.panels.filter((p) => p.ok).length}/${file.manifest.panels.length}`,
      `زمان: ${new Date().toLocaleString("fa-IR")}`,
      file.size > 48 * 1024 * 1024
        ? "⚠️ حجم بالاست؛ اگر تلگرام رد کرد از داشبورد وب دانلود کنید."
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const targets = opts?.toChatId ? [opts.toChatId] : await listNotifyAdminTelegramIds();
    let sent = 0;
    let lastErr = "";
    for (const id of targets) {
      try {
        await api.sendDocument(id, new InputFile(file.path, file.name), { caption });
        sent++;
      } catch (err) {
        lastErr = String(err instanceof Error ? err.message : err);
        console.error("full migration send failed", id, err);
      }
    }

    return {
      ok: sent > 0,
      name: file.name,
      size: file.size,
      sent,
      panelsOk: file.manifest.panels.filter((p) => p.ok).length,
      panelsTotal: file.manifest.panels.length,
      path: file.path,
      error: sent > 0 ? undefined : lastErr || "ارسال ناموفق",
    };
  } catch (err) {
    return {
      ok: false,
      name: "",
      size: 0,
      sent: 0,
      panelsOk: 0,
      panelsTotal: 0,
      error: String(err instanceof Error ? err.message : err),
    };
  }
}

export function migrationArchiveBasename(path: string) {
  return basename(path);
}
