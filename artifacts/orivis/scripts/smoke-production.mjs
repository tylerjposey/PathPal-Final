import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { access, mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';

const appDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const smokeConfig = path.join(appDirectory, 'vite.smoke.config.ts');
const chromiumPath =
  process.env.CHROMIUM_PATH ?? '/repl/tools/bin/chromium';
const demoAccount = {
  status: 'worker',
  userId: 'demo-smoke-user',
  displayName: 'Demo Field Worker',
  familyId: null,
  familyName: null,
  approvalDeadline: null,
  teamName: 'Smoke Response Team',
};
const demoReports = [
  {
    id: 'smoke-report-1',
    category: 'Unsafe bus stops',
    summary: 'A blocked crossing needs review',
    description: 'A demo report used to verify the signed-in overview.',
    severity: 4,
    status: 'Assigned',
    location: 'Downtown San Jose',
    x: 0.5,
    y: 0.5,
    photoUri: null,
    photoReference: 'smoke-photo-reference',
    submittedAt: '2026-10-01T12:00:00.000Z',
    recommendedDepartment: 'Street Services',
    priority: 'Medium',
    assignedTeam: 'Smoke Response Team',
    awardedPoints: false,
    reporterAccountId: null,
    familyAccountId: null,
    reporterUserId: 'demo-smoke-user',
    familyId: null,
    selectedCategory: null,
    latitude: 37.3352,
    longitude: -121.8906,
  },
];

class DevToolsConnection {
  #nextId = 0;
  #pending = new Map();
  #listeners = new Map();

  constructor(socket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      let message;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }

      if (message.id) {
        const pending = this.#pending.get(message.id);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.#pending.delete(message.id);
        if (message.error) {
          pending.reject(
            new Error(message.error.message ?? 'Chrome DevTools command failed.'),
          );
        } else {
          pending.resolve(message.result ?? {});
        }
        return;
      }

      for (const listener of this.#listeners.get(message.method) ?? []) {
        listener(message.params ?? {});
      }
    });

    socket.addEventListener('close', () => {
      for (const pending of this.#pending.values()) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Chrome DevTools connection closed.'));
      }
      this.#pending.clear();
    });
  }

  on(method, listener) {
    const listeners = this.#listeners.get(method) ?? new Set();
    listeners.add(listener);
    this.#listeners.set(method, listeners);
    return () => listeners.delete(listener);
  }

  send(method, params = {}) {
    const id = ++this.#nextId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Chrome DevTools timed out on ${method}.`));
      }, 15_000);
      timeout.unref?.();
      this.#pending.set(id, { resolve, reject, timeout });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function getAvailablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const { port } = address;
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

async function waitForDevTools(port, browserProcess) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (browserProcess.exitCode !== null) {
      throw new Error(
        `Chromium exited before DevTools was ready (code ${browserProcess.exitCode}).`,
      );
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return response.json();
    } catch {
      // Chromium needs a short moment to create its DevTools endpoint.
    }
    await delay(100);
  }
  throw new Error('Chromium did not start its DevTools endpoint.');
}

async function openPageSocket(port) {
  const response = await fetch(
    `http://127.0.0.1:${port}/json/new?about%3Ablank`,
    { method: 'PUT', signal: AbortSignal.timeout(2_000) },
  );
  if (!response.ok) {
    throw new Error(`Chromium could not create a test page (${response.status}).`);
  }
  const target = await response.json();
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out connecting to Chromium.')),
      10_000,
    );
    socket.addEventListener(
      'open',
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
    socket.addEventListener(
      'error',
      () => {
        clearTimeout(timeout);
        reject(new Error('Could not connect to Chromium DevTools.'));
      },
      { once: true },
    );
  });
  return new DevToolsConnection(socket);
}

async function evaluate(connection, expression) {
  const result = await connection.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (result.exceptionDetails) {
    throw new Error(
      result.exceptionDetails.text ?? 'A browser expression failed.',
    );
  }
  return result.result?.value;
}

async function waitUntil(description, predicate, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${description}.`);
}

function jsonResponse(connection, requestId, payload, status = 200) {
  return connection.send('Fetch.fulfillRequest', {
    requestId,
    responseCode: status,
    responseHeaders: [
      { name: 'Content-Type', value: 'application/json; charset=utf-8' },
      { name: 'Cache-Control', value: 'no-store' },
    ],
    body: Buffer.from(JSON.stringify(payload)).toString('base64'),
  });
}

const originalNodeEnv = process.env.NODE_ENV;
const originalPort = process.env.PORT;
const previewPort = await getAvailablePort();
process.env.NODE_ENV = 'production';
process.env.PORT = String(previewPort);

let previewServer;
let browserProcess;
let profileDirectory;
let devTools;

try {
  await access(chromiumPath, constants.X_OK).catch(() => {
    throw new Error(
      `Chromium was not found at ${chromiumPath}. Set CHROMIUM_PATH to an executable browser.`,
    );
  });

  console.log('Building isolated smoke bundle with Vite production mode...');
  await build({
    configFile: smokeConfig,
    mode: 'production',
    logLevel: 'warn',
  });

  previewServer = await preview({
    configFile: smokeConfig,
    preview: {
      host: '127.0.0.1',
      port: previewPort,
      strictPort: true,
      allowedHosts: true,
    },
  });

  const debugPort = await getAvailablePort();
  profileDirectory = await mkdtemp(
    path.join(os.tmpdir(), 'orivis-production-smoke-'),
  );
  browserProcess = spawn(
    chromiumPath,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-allow-origins=*',
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profileDirectory}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );

  await waitForDevTools(debugPort, browserProcess);
  devTools = await openPageSocket(debugPort);

  const browserErrors = [];
  const fixtureErrors = [];
  const unexpectedApiRequests = [];
  let accountRequests = 0;
  let reportRequests = 0;

  devTools.on('Runtime.consoleAPICalled', (event) => {
    if (event.type !== 'error') return;
    browserErrors.push(
      (event.args ?? [])
        .map((argument) => argument.value ?? argument.description ?? '')
        .join(' '),
    );
  });
  devTools.on('Runtime.exceptionThrown', (event) => {
    browserErrors.push(
      event.exceptionDetails?.exception?.description ??
        event.exceptionDetails?.text ??
        'Uncaught browser exception.',
    );
  });
  devTools.on('Fetch.requestPaused', (event) => {
    void (async () => {
      try {
        const requestUrl = new URL(event.request.url);
        const method = event.request.method;
        if (method === 'GET' && requestUrl.pathname.endsWith('/api/accounts/me')) {
          accountRequests += 1;
          await jsonResponse(devTools, event.requestId, demoAccount);
          return;
        }
        if (method === 'GET' && requestUrl.pathname.endsWith('/api/reports')) {
          reportRequests += 1;
          await jsonResponse(devTools, event.requestId, demoReports);
          return;
        }
        unexpectedApiRequests.push(`${method} ${requestUrl.pathname}`);
        await jsonResponse(
          devTools,
          event.requestId,
          { error: `No smoke fixture for ${method} ${requestUrl.pathname}` },
          404,
        );
      } catch (error) {
        fixtureErrors.push(
          error instanceof Error ? error.message : String(error),
        );
      }
    })();
  });

  await devTools.send('Page.enable');
  await devTools.send('Runtime.enable');
  await devTools.send('Fetch.enable', {
    patterns: [{ urlPattern: '*://*/api/*', requestStage: 'Request' }],
  });

  const basePath = process.env.BASE_PATH ?? '/';
  const normalizedBasePath = basePath.startsWith('/')
    ? basePath
    : `/${basePath}`;
  const appUrl = `http://127.0.0.1:${previewPort}${normalizedBasePath}`;
  await devTools.send('Page.navigate', { url: appUrl });
  await waitUntil('the production sign-in screen', async () =>
    evaluate(
      devTools,
      `Boolean(document.querySelector('[data-testid="button-demo-session-sign-in"]'))`,
    ),
  );

  const signedIn = await evaluate(
    devTools,
    `(() => {
      const button = document.querySelector('[data-testid="button-demo-session-sign-in"]');
      if (!button) return false;
      button.click();
      return true;
    })()`,
  );
  assert.equal(signedIn, true, 'The demo sign-in button should be available.');

  let dashboardState;
  await waitUntil('the signed-in overview and fixture report', async () => {
    if (fixtureErrors.length) {
      throw new Error(`API fixture failed: ${fixtureErrors.join('; ')}`);
    }
    dashboardState = await evaluate(
      devTools,
      `(() => {
        const headings = [...document.querySelectorAll('h1')]
          .map((heading) => heading.textContent?.trim() ?? '');
        const report = document.querySelector('[data-testid="link-report-smoke-report-1"]');
        return {
          headings,
          reportText: report?.textContent?.trim() ?? '',
          hasReport: Boolean(report),
          boundaryShown: headings.some((text) => text === 'Something went wrong'),
        };
      })()`,
    );
    if (dashboardState.boundaryShown) {
      throw new Error('The production error boundary appeared after sign-in.');
    }
    return (
      dashboardState.headings.includes('Your team’s work, in one view.') &&
      dashboardState.hasReport
    );
  });

  assert.equal(dashboardState.boundaryShown, false);
  assert.ok(
    dashboardState.headings.includes('Your team’s work, in one view.'),
    'The signed-in dashboard heading should render.',
  );
  assert.match(
    dashboardState.reportText,
    /A blocked crossing needs review/,
    'The controlled report should render on the dashboard.',
  );
  assert.ok(accountRequests > 0, 'The signed-in account fixture should be read.');
  assert.ok(reportRequests > 0, 'The signed-in report fixture should be read.');
  assert.deepEqual(
    unexpectedApiRequests,
    [],
    'The overview should only call endpoints covered by its controlled API fixture.',
  );

  const browserErrorText = browserErrors.join('\n');
  assert.doesNotMatch(
    browserErrorText,
    /No QueryClient/i,
    'The production app must not report a missing React Query provider.',
  );
  assert.equal(
    browserErrors.length,
    0,
    `The production browser should not report uncaught errors:\n${browserErrorText}`,
  );

  console.log(
    `PASS: production sign-in reached the worker overview and rendered the fixture report (account requests: ${accountRequests}, report requests: ${reportRequests}).`,
  );
} finally {
  devTools?.close();
  if (browserProcess && browserProcess.exitCode === null) {
    browserProcess.kill('SIGTERM');
    await Promise.race([once(browserProcess, 'exit'), delay(3_000)]);
    if (browserProcess.exitCode === null) browserProcess.kill('SIGKILL');
  }
  await previewServer?.close();
  if (profileDirectory) {
    await rm(profileDirectory, { recursive: true, force: true });
  }
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalPort === undefined) delete process.env.PORT;
  else process.env.PORT = originalPort;
}