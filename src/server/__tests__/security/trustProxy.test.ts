import { describe, it, expect, afterAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import Fastify from 'fastify';
import { TRUST_PROXY } from '../../utils/trustProxy';

// request.ip is what every per-IP limit counts by (sign-in, sign-up, verify, resend, API key log)
const app = Fastify({ trustProxy: TRUST_PROXY });
app.get('/ip', async (request) => ({ ip: request.ip }));
afterAll(() => app.close());

const ipFor = async (remoteAddress: string, xff?: string) =>
  (await app.inject({ method: 'GET', url: '/ip', remoteAddress, headers: xff ? { 'x-forwarded-for': xff } : {} })).json().ip;

describe('the visitor address behind nginx', () => {
  it('is the entry nginx appended, never one the visitor wrote', async () => {
    // a visitor sends "X-Forwarded-For: 6.6.6.6"; nginx appends the address it really saw
    expect(await ipFor('127.0.0.1', '6.6.6.6, 203.0.113.9')).toBe('203.0.113.9');
    expect(await ipFor('127.0.0.1', '6.6.6.6, 127.0.0.1, 203.0.113.9')).toBe('203.0.113.9');
  });

  it('the same when nginx reaches the app over IPv6 or an IPv4-mapped address', async () => {
    expect(await ipFor('::1', '6.6.6.6, 203.0.113.9')).toBe('203.0.113.9');
    expect(await ipFor('::ffff:127.0.0.1', '6.6.6.6, 203.0.113.9')).toBe('203.0.113.9');
  });

  it('a request that does not come through nginx keeps its own address, whatever header it sends', async () => {
    expect(await ipFor('198.51.100.7', '6.6.6.6')).toBe('198.51.100.7');
  });

  it('with no header it is the connection address', async () => {
    expect(await ipFor('127.0.0.1')).toBe('127.0.0.1');
  });

  // A tripwire on the source text: the MCP server is Express (its own package), so its behaviour
  // is not run here — Express uses the same proxy-addr rule as above.
  it('both servers use the loopback rule, never "trust everything"', () => {
    const root = join(__dirname, '../../../..');
    const appSrc = readFileSync(join(root, 'src/server/index.ts'), 'utf-8');
    expect(appSrc).toMatch(/trustProxy: TRUST_PROXY/);
    expect(appSrc).not.toMatch(/trustProxy:\s*true/);
    const mcpSrc = readFileSync(join(root, 'mcp-server/src/index.ts'), 'utf-8');
    expect(mcpSrc).toMatch(/app\.set\('trust proxy', 'loopback'\)/);
    // the /mcp proxy hands the MCP server the visitor's address, not 127.0.0.1
    const proxySrc = readFileSync(join(root, 'src/server/routes/integrations/mcpProxy.ts'), 'utf-8');
    expect(proxySrc).toMatch(/headers\['x-forwarded-for'\] = request\.ip/);
  });
});
