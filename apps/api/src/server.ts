import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { access, mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { buildOnlineDownloadArgs, parseScanResultObject } from '../../../packages/core/src';
import type { ApiErrorBody, JobRequest, JobSnapshot, JobStatus } from '../../../packages/core/src';

const PORT = Number(process.env.PORT || process.env.YTDL_STUDIO_API_PORT || 8787);
const API_TOKEN = process.env.YTDL_STUDIO_API_TOKEN || '';
const DEV_AUTH = process.env.YTDL_STUDIO_DEV_AUTH === '1';
const OUTPUT_DIR = resolve(process.env.YTDL_STUDIO_OUTPUT_DIR || '/tmp/ytdl-studio-online');
const PUBLIC_BASE_URL = process.env.YTDL_STUDIO_PUBLIC_BASE_URL || `http://localhost:${PORT}`;
const DOWNLOAD_TTL_MS = 24 * 60 * 60 * 1000;
const TOOL_PATH_DIRS = [
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
];

interface JobState extends JobSnapshot {
  url: string;
  outputDir: string;
  outputPath?: string;
  process?: ChildProcess;
  clients: Set<ServerResponse>;
  stderrTail: string[];
  token?: string;
  expiresAtMs?: number;
}

const jobs = new Map<string, JobState>();
const rateBuckets = new Map<string, { count: number; resetAt: number }>();
let toolPathsPromise: Promise<{ ytDlp: string; ffmpeg?: string }> | undefined;

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
  });
  res.end(JSON.stringify(body));
}

function apiError(error: string, message: string): ApiErrorBody {
  return { error, message };
}

function requireAuth(req: IncomingMessage, url: URL): ApiErrorBody | null {
  if (DEV_AUTH) return null;
  if (!API_TOKEN) {
    return apiError('AUTH_NOT_CONFIGURED', 'Servidor sem YTDL_STUDIO_API_TOKEN configurado.');
  }

  const header = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  const queryToken = url.searchParams.get('token')?.trim();
  const provided = header || queryToken || '';
  const expected = Buffer.from(API_TOKEN);
  const actual = Buffer.from(provided);

  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return apiError('UNAUTHORIZED', 'Autenticação obrigatória.');
  }

  return null;
}

function rateLimitKey(req: IncomingMessage): string {
  const auth = req.headers.authorization || 'anonymous';
  const ip = req.socket.remoteAddress || 'unknown';
  return createHash('sha256').update(`${auth}:${ip}`).digest('hex');
}

function checkRateLimit(req: IncomingMessage): ApiErrorBody | null {
  const key = rateLimitKey(req);
  const now = Date.now();
  const bucket = rateBuckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    rateBuckets.set(key, { count: 1, resetAt: now + 60_000 });
    return null;
  }

  bucket.count += 1;
  if (bucket.count > 60) {
    return apiError('RATE_LIMITED', 'Limite de requisições excedido. Tente novamente em instantes.');
  }

  return null;
}

function validatePublicYouTubeUrl(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error('URL obrigatória.');
  }

  const url = new URL(value);
  const hostname = url.hostname.replace(/^www\./, '');
  const isWatch = hostname === 'youtube.com' && url.pathname === '/watch' && url.searchParams.has('v');
  const isShort = hostname === 'youtu.be' && url.pathname.length > 1;

  if (!isWatch && !isShort) {
    throw new Error('Somente URLs públicas de vídeo do YouTube são aceitas.');
  }

  return url.toString();
}

async function readJson(req: IncomingMessage): Promise<any> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    chunks.push(buffer);
    totalBytes += buffer.byteLength;
    if (totalBytes > 64 * 1024) {
      throw new Error('Payload grande demais.');
    }
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}

function authRequiredMessage(stderr: string): boolean {
  return /sign in|private|members-only|members only|login|authentication|cookies/i.test(stderr);
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function resolveTool(binaryName: string, envName: string): Promise<string | undefined> {
  const envPath = process.env[envName];
  if (envPath && await isExecutable(envPath)) return envPath;

  const pathDirs = (process.env.PATH || '')
    .split(':')
    .map((dir) => dir.trim())
    .filter(Boolean);
  const candidates = [...TOOL_PATH_DIRS, ...pathDirs].map((dir) => join(dir, binaryName));

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) return candidate;
  }

  return undefined;
}

async function getToolPaths(): Promise<{ ytDlp: string; ffmpeg?: string }> {
  toolPathsPromise ??= Promise.all([
    resolveTool('yt-dlp', 'YTDL_STUDIO_YTDLP_PATH'),
    resolveTool('ffmpeg', 'YTDL_STUDIO_FFMPEG_PATH'),
  ]).then(([ytDlp, ffmpeg]) => {
    if (!ytDlp) {
      throw apiError(
        'YTDLP_NOT_FOUND',
        'yt-dlp não encontrado. Configure YTDL_STUDIO_YTDLP_PATH ou instale em /opt/homebrew/bin/yt-dlp.'
      );
    }
    return { ytDlp, ffmpeg };
  });
  return toolPathsPromise;
}

function toolEnv(paths: { ytDlp: string; ffmpeg?: string }): NodeJS.ProcessEnv {
  const dirs = new Set([
    dirname(paths.ytDlp),
    paths.ffmpeg ? dirname(paths.ffmpeg) : '',
    ...TOOL_PATH_DIRS,
    ...(process.env.PATH || '').split(':'),
  ].filter(Boolean));

  return {
    ...process.env,
    PATH: [...dirs].join(':'),
  };
}

async function runYtDlpJson(url: string): Promise<any> {
  const paths = await getToolPaths();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(paths.ytDlp, ['--no-playlist', '-J', url], {
      env: toolEnv(paths),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(apiError('SCAN_TIMEOUT', 'A análise demorou demais e foi cancelada.'));
    }, 30_000);
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(apiError('YTDLP_SPAWN_FAILED', `Falha ao iniciar yt-dlp: ${error.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const err = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        reject(
          authRequiredMessage(err)
            ? apiError(
                'AUTH_REQUIRED_UNSUPPORTED',
                'Este conteúdo exige login ou assinatura. A versão online não processa sessões privadas. Use o app desktop.'
              )
            : apiError('SCAN_FAILED', err || `yt-dlp terminou com código ${code}`)
        );
        return;
      }
      resolvePromise(JSON.parse(Buffer.concat(stdout).toString('utf8')));
    });
  });
}

function emit(job: JobState) {
  const snapshot = snapshotJob(job);
  for (const client of job.clients) {
    client.write(`data: ${JSON.stringify(snapshot)}\n\n`);
  }
}

function snapshotJob(job: JobState): JobSnapshot {
  return {
    id: job.id,
    status: job.status,
    phase: job.phase,
    progress: job.progress,
    error: job.error,
    downloadUrl: job.downloadUrl,
    expiresAt: job.expiresAt,
  };
}

function setJobStatus(job: JobState, status: JobStatus, phase: string, progress?: number) {
  job.status = status;
  job.phase = phase;
  if (progress !== undefined) job.progress = progress;
  emit(job);
}

function parseProgress(line: string): number | undefined {
  const match = line.match(/\[download\]\s+([0-9.]+)%/);
  return match ? Number(match[1]) : undefined;
}

async function newestOutputFile(dir: string): Promise<string | undefined> {
  const entries = await readdir(dir);
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry);
      const info = await stat(path);
      return info.isFile() ? { path, mtimeMs: info.mtimeMs } : null;
    })
  );
  return files
    .filter((file): file is { path: string; mtimeMs: number } => Boolean(file))
    .sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.path;
}

async function startJob(selection: JobRequest): Promise<JobState> {
  const url = validatePublicYouTubeUrl(selection.url);
  const paths = await getToolPaths();
  const id = randomUUID();
  const outputDir = join(OUTPUT_DIR, id);
  await mkdir(outputDir, { recursive: true });

  const outputTemplate = join(outputDir, '%(title).180B [%(id)s].%(ext)s');
  const args = buildOnlineDownloadArgs({ ...selection, url }, outputTemplate);
  if (paths.ffmpeg) {
    args.unshift('--ffmpeg-location', dirname(paths.ffmpeg));
  }
  const job: JobState = {
    id,
    url,
    status: 'queued',
    phase: 'Na fila',
    progress: 0,
    outputDir,
    clients: new Set(),
    stderrTail: [],
  };
  jobs.set(id, job);
  emit(job);

  const child = spawn(paths.ytDlp, args, { env: toolEnv(paths), stdio: ['ignore', 'pipe', 'pipe'] });
  job.process = child;
  setJobStatus(job, 'running', 'Iniciando download', 0);

  child.stdout.on('data', (chunk) => {
    const text = Buffer.from(chunk).toString('utf8');
    const progress = parseProgress(text);
    if (progress !== undefined) setJobStatus(job, 'downloading', 'Baixando', progress);
  });

  child.stderr.on('data', (chunk) => {
    const text = Buffer.from(chunk).toString('utf8');
    job.stderrTail.push(text);
    job.stderrTail = job.stderrTail.slice(-20);
    const progress = parseProgress(text);
    if (progress !== undefined) setJobStatus(job, 'downloading', 'Baixando', progress);
    if (/merging|Merger/i.test(text)) setJobStatus(job, 'merging', 'Mesclando', job.progress);
  });

  child.on('error', (error) => {
    job.error = apiError('JOB_SPAWN_FAILED', `Falha ao iniciar yt-dlp: ${error.message}`);
    setJobStatus(job, 'failed', 'Falha', job.progress);
  });

  child.on('close', async (code) => {
    if (job.status === 'cancelled') return;
    if (code !== 0) {
      const stderr = job.stderrTail.join('').trim();
      job.error = authRequiredMessage(stderr)
        ? apiError(
            'AUTH_REQUIRED_UNSUPPORTED',
            'Este conteúdo exige login ou assinatura. A versão online não processa sessões privadas. Use o app desktop.'
          )
        : apiError('JOB_FAILED', stderr || `yt-dlp terminou com código ${code}`);
      setJobStatus(job, 'failed', 'Falha', job.progress);
      return;
    }

    setJobStatus(job, 'uploading', 'Preparando link', 100);
    const outputPath = await newestOutputFile(outputDir);
    if (!outputPath) {
      job.error = apiError('OUTPUT_NOT_FOUND', 'Download terminou, mas o arquivo final não foi encontrado.');
      setJobStatus(job, 'failed', 'Falha', 100);
      return;
    }

    job.outputPath = outputPath;
    job.token = randomUUID();
    job.expiresAtMs = Date.now() + DOWNLOAD_TTL_MS;
    job.expiresAt = new Date(job.expiresAtMs).toISOString();
    job.downloadUrl = `${PUBLIC_BASE_URL}/jobs/${id}/download?token=${encodeURIComponent(job.token)}`;
    setJobStatus(job, 'completed', 'Concluído', 100);
  });

  return job;
}

function jobFromPath(pathname: string): { id: string; action: string } | null {
  const match = pathname.match(/^\/jobs\/([^/]+)(?:\/([^/]+))?$/);
  return match ? { id: decodeURIComponent(match[1]), action: match[2] || '' } : null;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', 'content-type, authorization');
  res.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS');
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', PUBLIC_BASE_URL);
  if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/')) {
    return json(res, 200, { status: 'ok', service: 'ytdl-studio-api', version: '0.1.3' });
  }

  const routedJob = jobFromPath(url.pathname);
  const isSignedDownload = req.method === 'GET' && routedJob?.action === 'download';
  if (!isSignedDownload) {
    const authError = requireAuth(req, url);
    if (authError) return json(res, 401, authError);
  }
  const limited = checkRateLimit(req);
  if (limited) return json(res, 429, limited);

  try {
    if (req.method === 'POST' && url.pathname === '/scan') {
      const body = await readJson(req);
      const videoUrl = validatePublicYouTubeUrl(body.url);
      const raw = await runYtDlpJson(videoUrl);
      return json(res, 200, parseScanResultObject(raw));
    }

    if (req.method === 'POST' && url.pathname === '/jobs') {
      const body = (await readJson(req)) as JobRequest;
      const job = await startJob(body);
      return json(res, 202, snapshotJob(job));
    }

    if (routedJob) {
      const job = jobs.get(routedJob.id);
      if (!job) return json(res, 404, apiError('JOB_NOT_FOUND', 'Job não encontrado.'));

      if (req.method === 'GET' && !routedJob.action) {
        return json(res, 200, snapshotJob(job));
      }

      if (req.method === 'GET' && routedJob.action === 'events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          connection: 'keep-alive',
          'access-control-allow-origin': '*',
        });
        job.clients.add(res);
        res.write(`data: ${JSON.stringify(snapshotJob(job))}\n\n`);
        req.on('close', () => job.clients.delete(res));
        return;
      }

      if (req.method === 'GET' && routedJob.action === 'download') {
        if (!job.outputPath || !job.token || url.searchParams.get('token') !== job.token) {
          return json(res, 403, apiError('DOWNLOAD_FORBIDDEN', 'Link inválido.'));
        }
        if (!job.expiresAtMs || Date.now() > job.expiresAtMs) {
          return json(res, 410, apiError('DOWNLOAD_EXPIRED', 'Link expirado.'));
        }

        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename="${(job.outputPath.split('/').pop() || 'download').replace(/["\r\n]/g, '_')}"`,
        });
        createReadStream(job.outputPath).pipe(res);
        return;
      }

      if (req.method === 'POST' && routedJob.action === 'cancel') {
        job.process?.kill('SIGTERM');
        setJobStatus(job, 'cancelled', 'Cancelado', job.progress);
        return json(res, 200, snapshotJob(job));
      }
    }

    return json(res, 404, apiError('NOT_FOUND', 'Endpoint não encontrado.'));
  } catch (error) {
    if (typeof error === 'object' && error && 'error' in error && 'message' in error) {
      return json(res, 400, error);
    }
    return json(
      res,
      400,
      apiError('BAD_REQUEST', error instanceof Error ? error.message : String(error))
    );
  }
}

setInterval(() => {
  const now = Date.now();
  for (const job of jobs.values()) {
    if (job.expiresAtMs && job.expiresAtMs < now) {
      if (job.outputPath) void unlink(job.outputPath).catch(() => undefined);
      jobs.delete(job.id);
    }
  }
}, 60 * 60 * 1000).unref();

await mkdir(OUTPUT_DIR, { recursive: true });
createServer((req, res) => {
  void handle(req, res);
}).listen(PORT, () => {
  console.log(`YTDL Studio API listening on ${PUBLIC_BASE_URL}`);
  if (!API_TOKEN && !DEV_AUTH) {
    console.warn('YTDL_STUDIO_API_TOKEN is required for authenticated requests.');
  }
});
